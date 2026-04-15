process.on('uncaughtException', (e) => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', (e) => console.error('UNHANDLED:', e));

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const provinces = require("./provinces");
const borders = require("./borders");
const authRouter = require("./auth");
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});
const rooms = new Map();
const deleteTimers = new Map();

const sessionMiddleware = session({
    secret: "dominium-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
});

app.use(cookieParser());
app.use(express.json());
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, "../client")));
app.use("/auth", authRouter);

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/login.html"));
});

app.post("/leave-room", (req, res) => {
    req.session.roomId = null;
    req.session.save();
    res.sendStatus(200);
});

const MAX_ROOMS = 3;

function generateRoomId() {
    for (let i = 1; i <= MAX_ROOMS; i++) {
        if (!rooms.has(String(i))) {
            return String(i);
        }
    }
    return null;
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRooms() {
    const roomList = [];
    rooms.forEach((room, roomId) => {
        roomList.push({
            id: roomId,
            players: room.players.length
        });
    });
    return roomList;
}

async function getPlayersWithNames(room) {
    const players = [];
    for (const socketId of room.players) {
        const connectedSocket = io.sockets.sockets.get(socketId);
        const name = connectedSocket?.request?.session?.userName || socketId;
        players.push({
            id: socketId,
            name,
            ready: room.readyPlayers?.has(socketId) || false
        });
    }
    return players;
}

async function emitPlayersUpdated(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const players = await getPlayersWithNames(room);
    io.to(roomId).emit("players_updated", { players });
}

function debugRooms(msg) {
    console.log("[ROOMS DEBUG]", msg, "keys:", Array.from(rooms.keys()));
}

function resolveTies(playersWithRolls, resolved = []) {
    playersWithRolls.sort((a, b) => b.roll - a.roll);
    const groups = [];
    let currentGroup = [playersWithRolls[0]];
    for (let i = 1; i < playersWithRolls.length; i++) {
        if (playersWithRolls[i].roll === currentGroup[0].roll) {
            currentGroup.push(playersWithRolls[i]);
        } else {
            groups.push(currentGroup);
            currentGroup = [playersWithRolls[i]];
        }
    }
    groups.push(currentGroup);
    for (const group of groups) {
        if (group.length === 1) {
            resolved.push(group[0]);
        } else {
            const rerolled = group.map(p => ({ ...p, roll: Math.floor(Math.random() * 6) + 1 }));
            resolveTies(rerolled, resolved);
        }
    }
    return resolved;
}

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");
    socket.emit("provinces_data", provinces);

    socket.on("set_name", (name) => {
        if (!name || typeof name !== "string") return;
        const trimmedName = name.trim().substring(0, 20);
        const roomId = socket.request.session.roomId;
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                // Exclude current socket's own name when checking (e.g. re-setting same name)
                const existingNames = room.players
                    .filter(pid => pid !== socket.id)
                    .map(pid => io.sockets.sockets.get(pid)?.request?.session?.userName)
                    .filter(n => n);
                if (existingNames.includes(trimmedName)) {
                    socket.emit("name_taken");
                    return;
                }
            }
        }
        socket.request.session.userName = trimmedName;
        socket.request.session.save(() => {
            if (roomId) emitPlayersUpdated(roomId);
        });
        socket.emit("name_ok");
    });

    socket.on("get_rooms", () => {
        socket.emit("rooms_list", getRooms());
    });

    socket.on("create_room", () => {
        const roomId = generateRoomId();
        if (roomId === null) {
            socket.emit("error", { message: "Numero massimo di stanze raggiunto" });
            return;
        }
        const roomCode = generateRoomCode();
        rooms.set(roomId, {
            room_code: roomCode,
            map_id: null,
            players: [socket.id],
            readyPlayers: new Set(),
            selectedContinents: new Map(),
            gameCountdown: null,
            gameStarted: false,
            gameTimerEnd: null,
            endGameTimeout: null,
            gameResults: null,
            gameEnded: false,
            defeatedOrder: [] // tracks elimination order: first = first eliminated
        });
        socket.join(roomId);
        socket.request.session.roomId = roomId;
        socket.request.session.save((err) => {
            if (err) console.error("[CREATE] Errore salvataggio sessione:", err);
            socket.emit("room_created", { roomId, roomCode });
            io.emit("rooms_updated");
            emitPlayersUpdated(roomId);
        });
    });

    socket.on("join_room", (roomId, roomCode) => {
        const room = rooms.get(roomId);
        if (!room) { socket.emit("error", { message: "Stanza non trovata" }); return; }
        if (room.room_code !== roomCode.toUpperCase()) { socket.emit("error", { message: "Codice stanza errato" }); return; }
        if (room.players.length >= 4) { socket.emit("error", { message: "Stanza piena" }); return; }

        room.players.push(socket.id);
        socket.join(roomId);
        const savedContinent = socket.request.session.selectedContinent;
        if (savedContinent && room.gameStarted) {
            const playerName = socket.request.session.userName;
            room.selectedContinents.set(savedContinent, playerName);
        }
        socket.request.session.roomId = roomId;
        socket.request.session.save((err) => {
            if (err) console.error("[JOIN] Errore salvataggio sessione:", err);
            socket.emit("room_joined", { roomId, roomCode: room.room_code });
            io.emit("rooms_updated");
            emitPlayersUpdated(roomId);
            room.players.forEach(playerId => {
                const playerSocket = io.sockets.sockets.get(playerId);
                if (playerSocket) {
                    playerSocket.emit("continents_updated", {
                        selectedContinents: Object.fromEntries(room.selectedContinents),
                        currentPlayerId: playerId
                    });
                }
            });
        });
    });

    socket.on("rejoin_room", ({ roomId } = {}) => {
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        for (const key of [roomId]) {
            if (deleteTimers.has(key)) {
                clearTimeout(deleteTimers.get(key));
                deleteTimers.delete(key);
            }
        }
        if (!room.players.includes(socket.id)) room.players.push(socket.id);
        if (!room.readyPlayers) room.readyPlayers = new Set();
        socket.join(roomId);
        // Aggiorna socketId nel turnOrderDetails se il gioco è già iniziato
        if (room.gameStarted && room.turnOrderDetails) {
            const playerName = socket.request.session.userName;
            const playerDetail = room.turnOrderDetails.find(p => p.name === playerName);
            if (playerDetail) {
                // Aggiorna il vecchio socketId con quello nuovo
                const oldSocketId = playerDetail.socketId;
                playerDetail.socketId = socket.id;
                if (room.turnOrder) {
                    const idx = room.turnOrder.indexOf(oldSocketId);
                    if (idx !== -1) room.turnOrder[idx] = socket.id;
                }
            }
        }
        socket.emit("rejoined", { roomId });
        io.emit("rooms_updated");
        emitPlayersUpdated(roomId);
        room.players.forEach(playerId => {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
                playerSocket.emit("continents_updated", {
                    selectedContinents: Object.fromEntries(room.selectedContinents),
                    currentPlayerId: playerId
                });
            }
        });
        if (room.gameTimerEnd && !room.gameEnded) {
            const remaining = Math.max(0, Math.ceil((room.gameTimerEnd - Date.now()) / 1000));
            if (remaining > 0) {
                socket.emit("game_timer_start", { endTime: room.gameTimerEnd, serverTime: Date.now() });
            }
        }
    });

    socket.on("request_game_results", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || !room.gameResults) return;
        socket.emit("game_results", { roomId, results: room.gameResults });
    });

    socket.on("player_ready", ({ roomId, ready }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        if (!room.readyPlayers) room.readyPlayers = new Set();
        const readyName = socket.request.session.userName;
        if (ready && !Array.from(room.selectedContinents.values()).includes(readyName)) {
            socket.emit("error", { message: "Devi selezionare un continente prima di metterti pronto" });
            return;
        }
        if (ready) {
            room.readyPlayers.add(socket.id);
        } else {
            room.readyPlayers.delete(socket.id);
            if (room.gameCountdown) {
                clearTimeout(room.gameCountdown);
                room.gameCountdown = null;
                io.to(roomId).emit("countdown_stop");
            }
        }
        emitPlayersUpdated(roomId);
        if (room.players.length === 4 && room.readyPlayers.size === 4) {
            io.to(roomId).emit("game_countdown_start", { seconds: 3 });
            room.gameCountdown = setTimeout(() => {
                io.to(roomId).emit("game_start");
                room.isRollingForTroops = true;
                room.gameStarted = true;
                room.gameCountdown = null;
                const gameDuration = 15 * 60;
                room.gameTimerEnd = Date.now() + gameDuration * 1000;
                room.endGameTimeout = setTimeout(() => concludeGame(roomId, "time"), gameDuration * 1000);
                io.to(roomId).emit("game_timer_start", { endTime: room.gameTimerEnd, serverTime: Date.now() });
            }, 3000);
        }
    });

    socket.on("select_continent", ({ roomId, continent }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const playerName = socket.request.session.userName;
        for (const [cont, name] of room.selectedContinents) {
            if (name === playerName) room.selectedContinents.delete(cont);
        }
        if (!room.selectedContinents.has(continent)) room.selectedContinents.set(continent, playerName);
        socket.request.session.selectedContinent = continent;
        socket.request.session.save();
        room.players.forEach(playerId => {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
                const currentName = playerSocket.request.session.userName;
                playerSocket.emit("continents_updated", {
                    selectedContinents: Object.fromEntries(room.selectedContinents),
                    currentPlayerName: currentName
                });
            }
        });
    });

    socket.on("edit_room_name", (roomName, roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;
        room.room_name = roomName;
        io.emit("rooms_updated");
    });

    socket.on("leave_room", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const wasCurrentPlayer = room.gameStarted && room.turnOrder && room.turnOrder[room.currentTurnIndex] === socket.id;
        room.players = room.players.filter(p => p !== socket.id);
        room.readyPlayers?.delete(socket.id);
        if (room.gameCountdown) {
            clearTimeout(room.gameCountdown);
            room.gameCountdown = null;
            io.to(roomId).emit("countdown_stop");
        }
        if (!room.gameStarted) {
            const leavingName = socket.request.session.userName;
            for (const [continent, name] of room.selectedContinents) {
                if (name === leavingName) room.selectedContinents.delete(continent);
            }
        } else {
            // During game: mark that player's provinces as no-man's-land (owner = null)
            const leavingName = socket.request.session.userName;
            if (room.provinces) {
                for (const province of Object.values(room.provinces)) {
                    if (province.owner === leavingName) {
                        province.owner = null;
                        province.noMansLand = true;
                    }
                }
                // Emit updates for all affected provinces
                for (const [provinceId, province] of Object.entries(room.provinces)) {
                    if (province.noMansLand) {
                        io.to(roomId).emit("province_updated", {
                            provinceId,
                            troops: province.troops,
                            ownerName: null,
                            noMansLand: true
                        });
                    }
                }
            }
            // If the leaving player was the current player, advance turn
            if (wasCurrentPlayer) {
                let nextIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
                let attempts = 0;
                while (attempts < room.turnOrder.length) {
                    const nextPlayer = room.turnOrderDetails.find(p => p.socketId === room.turnOrder[nextIndex]);
                    if (!nextPlayer || !nextPlayer.defeated) break;
                    nextIndex = (nextIndex + 1) % room.turnOrder.length;
                    attempts++;
                }
                room.currentTurnIndex = nextIndex;
                io.to(roomId).emit("turn", {
                    currentPlayerId: room.turnOrder[room.currentTurnIndex],
                    turnOrder: room.turnOrderDetails
                });
            }
        }
        if (room.players.length === 0) {
            const timer = setTimeout(() => {
                if (rooms.has(roomId) && rooms.get(roomId).players.length === 0) {
                    rooms.delete(roomId);
                    io.emit("rooms_updated");
                    debugRooms(`rooms.delete(${roomId}) timeout`);
                }
            }, 5000);
            deleteTimers.set(roomId, timer);
        } else {
            emitPlayersUpdated(roomId);
            io.emit("rooms_updated");
        }
        socket.request.session.roomId = null;
        socket.request.session.save();
        debugRooms(`after leave_room ${roomId}, socket ${socket.id}`);
    });

    socket.on("disconnect", () => {
        rooms.forEach((room, roomId) => {
            if (!room.players.includes(socket.id)) return;
            const wasCurrentPlayer = room.gameStarted && room.turnOrder && room.turnOrder[room.currentTurnIndex] === socket.id;
            room.players = room.players.filter(p => p !== socket.id);
            room.readyPlayers?.delete(socket.id);
            if (room.gameCountdown) {
                clearTimeout(room.gameCountdown);
                room.gameCountdown = null;
                io.to(roomId).emit("countdown_stop");
            }
            // During game disconnect: mark provinces as no-man's-land
            if (room.gameStarted && room.provinces) {
                const leavingName = socket.request?.session?.userName;
                if (leavingName) {
                    for (const [provinceId, province] of Object.entries(room.provinces)) {
                        if (province.owner === leavingName) {
                            province.owner = null;
                            province.noMansLand = true;
                            io.to(roomId).emit("province_updated", {
                                provinceId,
                                troops: province.troops,
                                ownerName: null,
                                noMansLand: true
                            });
                        }
                    }
                }
                // If the disconnecting player was the current player, advance turn
                if (wasCurrentPlayer) {
                    let nextIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
                    let attempts = 0;
                    while (attempts < room.turnOrder.length) {
                        const nextPlayer = room.turnOrderDetails.find(p => p.socketId === room.turnOrder[nextIndex]);
                        if (!nextPlayer || !nextPlayer.defeated) break;
                        nextIndex = (nextIndex + 1) % room.turnOrder.length;
                        attempts++;
                    }
                    room.currentTurnIndex = nextIndex;
                    io.to(roomId).emit("turn", {
                        currentPlayerId: room.turnOrder[room.currentTurnIndex],
                        turnOrder: room.turnOrderDetails
                    });
                }
            } else if (!room.gameStarted) {
                for (const [continent, playerId] of room.selectedContinents) {
                    if (playerId === socket.id) room.selectedContinents.delete(continent);
                }
            }
            emitPlayersUpdated(roomId);
            if (room.players.length === 0) {
                const timer = setTimeout(() => {
                    if (rooms.has(roomId) && rooms.get(roomId).players.length === 0) {
                        rooms.delete(roomId);
                        io.emit("rooms_updated");
                        debugRooms(`rooms.delete(${roomId}) timeout on disconnect`);
                    }
                }, 5000);
                deleteTimers.set(roomId, timer);
            }
        });
        setTimeout(() => io.emit("rooms_updated"), 100);
        debugRooms(`after disconnect ${socket.id}`);
    });

    // --- GAME LOGIC ---

    socket.on("get_attackable_provinces", ({ provinceId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;
        const player = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!player) return;
        const attacker = room.provinces[provinceId];
        if (!attacker || attacker.owner !== player.name) return;
        if (attacker.troops < 1) {
            socket.emit("error", { message: "You need at least 1 troop to attack" });
            return;
        }
        const neighbors = borders[provinceId] || [];
        const attackable = neighbors.filter(id => {
            const p = room.provinces[id];
            // Cannot attack no-man's-land or unowned provinces
            return p && p.owner && p.owner !== player.name && !p.noMansLand;
        });
        socket.emit("attackable_provinces", { fromProvinceId: provinceId, attackable });
    });

    socket.on("attack", ({ fromProvinceId, toProvinceId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;
        const attackerPlayer = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!attackerPlayer) return;
        const attacker = room.provinces[fromProvinceId];
        const defender = room.provinces[toProvinceId];
        if (!attacker || !defender) return;
        if (attacker.owner !== attackerPlayer.name) return;
        if (defender.owner === attackerPlayer.name) return;
        if (defender.noMansLand) return; // Cannot attack no-man's-land
        if (attacker.troops < 1) {
            socket.emit("error", { message: "You need at least 1 troop to attack" });
            return;
        }
        const neighbors = borders[fromProvinceId] || [];
        if (!neighbors.includes(toProvinceId)) {
            socket.emit("error", { message: "Province non confinanti" });
            return;
        }
        const defenderPlayer = room.turnOrderDetails.find(p => p.name === defender.owner);
        if (!defenderPlayer) return;

        const maxAttackerDice = Math.min(3, Math.max(1, attacker.troops));
        const maxDefenderDice = Math.min(2, Math.max(1, defender.troops));

        room.pendingBattle = {
            fromProvinceId,
            toProvinceId,
            attackerSocketId: socket.id,
            defenderSocketId: defenderPlayer.socketId,
            attackerName: attackerPlayer.name,
            defenderName: defenderPlayer.name,
            maxAttackerDice,
            maxDefenderDice,
            attackerRolls: null,
            defenderRolls: null,
        };

        socket.emit("battle_roll_request", {
            role: "attacker",
            maxDice: maxAttackerDice,
            attackerName: attackerPlayer.name,
            defenderName: defenderPlayer.name,
            fromProvinceId,
            toProvinceId,
            attackerTroops: attacker.troops,
            defenderTroops: defender.troops,
        });

        const defenderSocket = io.sockets.sockets.get(defenderPlayer.socketId);
        if (defenderSocket) {
            defenderSocket.emit("battle_roll_request", {
                role: "defender",
                maxDice: maxDefenderDice,
                attackerName: attackerPlayer.name,
                defenderName: defenderPlayer.name,
                fromProvinceId,
                toProvinceId,
                attackerTroops: attacker.troops,
                defenderTroops: defender.troops,
            });
        }

        io.to(roomId).emit("battle_started", {
            attackerName: attackerPlayer.name,
            defenderName: defenderPlayer.name,
            fromProvinceId,
            toProvinceId,
            attackerTroops: attacker.troops,
            defenderTroops: defender.troops,
        });
    });

    socket.on("submit_battle_rolls", ({ roomId, rolls }) => {
        const room = rooms.get(roomId);
        if (!room || !room.pendingBattle) return;

        const battle = room.pendingBattle;
        const isAttacker = socket.id === battle.attackerSocketId;
        const isDefender = socket.id === battle.defenderSocketId;
        if (!isAttacker && !isDefender) return;

        const maxDice = isAttacker ? battle.maxAttackerDice : battle.maxDefenderDice;
        if (!Array.isArray(rolls) || rolls.length < 1 || rolls.length > maxDice) return;
        if (rolls.some(r => r < 1 || r > 6)) return;

        if (isAttacker) battle.attackerRolls = rolls;
        if (isDefender) battle.defenderRolls = rolls;

        io.to(roomId).emit("battle_player_rolled", {
            role: isAttacker ? "attacker" : "defender",
            name: isAttacker ? battle.attackerName : battle.defenderName,
        });

        if (!battle.attackerRolls || !battle.defenderRolls) return;

        const attackerDices = [...battle.attackerRolls].sort((a, b) => b - a);
        const defenderDices = [...battle.defenderRolls].sort((a, b) => b - a);

        let attackerLosses = 0;
        let defenderLosses = 0;
        const rounds = Math.min(attackerDices.length, defenderDices.length);
        for (let i = 0; i < rounds; i++) {
            if (attackerDices[i] > defenderDices[i]) defenderLosses++;
            else attackerLosses++;
        }

        const attacker = room.provinces[battle.fromProvinceId];
        const defender = room.provinces[battle.toProvinceId];
        const attackerPlayer = room.turnOrderDetails.find(p => p.socketId === battle.attackerSocketId);
        const defenderPlayer = room.turnOrderDetails.find(p => p.name === battle.defenderName);

        attacker.troops -= attackerLosses;
        defender.troops -= defenderLosses;
        attackerPlayer.troops -= attackerLosses;
        defenderPlayer.troops -= defenderLosses;

        if (attacker.troops < 0) attacker.troops = 0;
        if (defender.troops < 0) defender.troops = 0;

        if (attacker.troops <= 0) {
            attacker.troops = 0;
            attacker.owner = defenderPlayer.name;

            const defenderTroopsAvailable = defender.troops;

            let defenderAutoMoved = false;
            let defenderMinMovable = 0;
            let defenderMaxMovable = 0;

            if (defenderTroopsAvailable <= 1) {
                defender.troops = 1;
                attacker.troops = 1;
                defenderAutoMoved = true;
            } else {
                defender.troops = defenderTroopsAvailable - 1;
                attacker.troops = 1;
                defenderMinMovable = 0;
                defenderMaxMovable = Math.max(0, defender.troops - 1);
                if (defenderMaxMovable === 0) {
                    defenderAutoMoved = true;
                }
            }

            io.to(roomId).emit("attack_result", {
                winner: "defender",
                fromProvinceId: battle.fromProvinceId,
                toProvinceId: battle.toProvinceId,
                attackerName: battle.attackerName,
                defenderName: battle.defenderName,
                attackerDices,
                defenderDices,
                attackerLosses,
                defenderLosses,
                provinceConquered: false,
                autoMoved: defenderAutoMoved,
                defenderConqueredAttackerProvince: true,
                defenderAutoMoved,
                defenderMinMovable,
                defenderMaxMovable,
            });

            io.to(roomId).emit("province_updated", {
                provinceId: battle.fromProvinceId,
                troops: attacker.troops,
                ownerName: attacker.owner
            });
            io.to(roomId).emit("province_updated", {
                provinceId: battle.toProvinceId,
                troops: defender.troops,
                ownerName: defender.owner
            });

            checkVictoryCondition(room, roomId);
            removeDefeatedPlayers(room, roomId, io);

            const troopsTotals = getTroopsTotalByOwner(room);
            const attackerSocket = io.sockets.sockets.get(battle.attackerSocketId);
            const defenderSocket = io.sockets.sockets.get(battle.defenderSocketId);
            if (attackerSocket) {
                attackerSocket.emit("player_troops_updated", {
                    playerName: battle.attackerName,
                    troopsRemaining: troopsTotals[battle.attackerName] || 0
                });
            }
            if (defenderSocket) {
                defenderSocket.emit("player_troops_updated", {
                    playerName: battle.defenderName,
                    troopsRemaining: troopsTotals[battle.defenderName] || 0
                });
            }

            if (!defenderAutoMoved) {
                room.pendingDefenderTroopMove = {
                    fromProvinceId: battle.toProvinceId,
                    toProvinceId: battle.fromProvinceId,
                    defenderSocketId: battle.defenderSocketId,
                    minTroops: defenderMinMovable,
                    maxTroops: defenderMaxMovable,
                };
            }

            room.pendingBattle = null;
            return;
        }

        const provinceConquered = defender.troops <= 0;
        const roundWinner = defenderLosses > attackerLosses ? "attacker" : "defender";

        if (provinceConquered) {
            defender.owner = attackerPlayer.name;
            attacker.troops = 1;
            defender.troops = 1;

            io.to(roomId).emit("attack_result", {
                winner: "attacker",
                fromProvinceId: battle.fromProvinceId,
                toProvinceId: battle.toProvinceId,
                attackerName: battle.attackerName,
                defenderName: battle.defenderName,
                attackerDices,
                defenderDices,
                attackerLosses,
                defenderLosses,
                provinceConquered: true,
                autoMoved: true,
                maxMovableTroops: 0,
                minMovableTroops: 0,
                defenderConqueredAttackerProvince: false,
            });

            io.to(roomId).emit("province_updated", {
                provinceId: battle.fromProvinceId,
                troops: attacker.troops,
                ownerName: attacker.owner
            });
            io.to(roomId).emit("province_updated", {
                provinceId: battle.toProvinceId,
                troops: defender.troops,
                ownerName: attackerPlayer.name
            });

            checkVictoryCondition(room, roomId);
            removeDefeatedPlayers(room, roomId, io);
            room.pendingBattle = null;
            return;
        } else {
            io.to(roomId).emit("attack_result", {
                winner: roundWinner,
                fromProvinceId: battle.fromProvinceId,
                toProvinceId: battle.toProvinceId,
                attackerName: battle.attackerName,
                defenderName: battle.defenderName,
                attackerDices,
                defenderDices,
                attackerLosses,
                defenderLosses,
                provinceConquered: false,
                autoMoved: false,
                defenderConqueredAttackerProvince: false,
            });

            io.to(roomId).emit("province_updated", {
                provinceId: battle.fromProvinceId,
                troops: attacker.troops,
                ownerName: attacker.owner
            });
            io.to(roomId).emit("province_updated", {
                provinceId: battle.toProvinceId,
                troops: defender.troops,
                ownerName: defender.owner
            });
        }

        room.pendingBattle = null;
    });

    socket.on("win_chance", ({ attackerTroops, defenderTroops }) => {
        const winner = resolveBattle(attackerTroops, defenderTroops);
        socket.emit("battle_result", { winner });
    });

    socket.on("roll_for_turn_order", (payload = {}) => {
        const roomId = String(payload.roomId || socket.request?.session?.roomId || "");
        let room = rooms.get(roomId);
        if (!room) {
            const fallbackRoom = Array.from(socket.rooms).find(r => r !== socket.id);
            if (fallbackRoom && rooms.has(fallbackRoom)) room = rooms.get(fallbackRoom);
        }
        if (!room) { socket.emit("error", { message: "Stanza non trovata" }); return; }
        const effectiveRoomId = roomId || Array.from(socket.rooms).find(r => r !== socket.id);
        socket.request.session.roomId = effectiveRoomId;
        socket.request.session.save(() => { });
        if (!room.turnOrderRolls) room.turnOrderRolls = {};
        if (room.turnOrderRolls[socket.id]) return;
        const roll = Math.floor(Math.random() * 6) + 1;
        room.turnOrderRolls[socket.id] = roll;
        const playerName = socket.request.session.userName || socket.id;
        io.to(effectiveRoomId).emit("player_rolled", { socketId: socket.id, name: playerName, roll });
        const totalPlayers = room.players.length;
        const totalRolled = Object.keys(room.turnOrderRolls).length;
        if (totalRolled < totalPlayers) return;
        processTurnOrderRolls(room, effectiveRoomId, io);
    });

    socket.on("place_troop", ({ provinceId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const player = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!player) return;
        const province = provinces[provinceId];
        const roomProvince = room.provinces[provinceId];

        // Cannot place on no-man's-land
        if (roomProvince && roomProvince.noMansLand) {
            socket.emit("error", { message: "Non puoi piazzare truppe qui" });
            return;
        }

        const isNativeContinent = province && province.continent === player.continent;
        const isOwned = roomProvince && roomProvince.owner === player.name;
        if (!isNativeContinent && !isOwned) {
            socket.emit("error", { message: "Non puoi piazzare truppe qui" });
            return;
        }
        if (player.troops <= 0) return;
        if (!room.provinces[provinceId]) room.provinces[provinceId] = { troops: 0, owner: null };
        room.provinces[provinceId].troops++;
        room.provinces[provinceId].owner = player.name;
        player.troops--;

        io.to(roomId).emit("province_updated", {
            provinceId,
            troops: room.provinces[provinceId].troops,
            ownerName: player.name,
        });

        checkVictoryCondition(room, roomId);
        const isFirstPlacement = room.turnCount === 0;
        if (!isFirstPlacement) {
            removeDefeatedPlayers(room, roomId, io);
        }

        socket.emit("troops_remaining", { troopsToPlaceLeft: player.troops });

        if (player.troops <= 0) {
            const isFirstPlacement = room.turnCount === 0;
            if (isFirstPlacement) {
                const continentProvinces = Object.entries(provinces)
                    .filter(([, p]) => p.continent === player.continent)
                    .map(([id]) => id);
                const allCovered = continentProvinces.every(id =>
                    room.provinces[id] && room.provinces[id].troops >= 1
                );
                if (!allCovered) {
                    let refund = 0;
                    continentProvinces.forEach(id => {
                        if (room.provinces[id]) {
                            refund += room.provinces[id].troops;
                            room.provinces[id].troops = 0;
                            room.provinces[id].owner = null;
                            io.to(roomId).emit("province_updated", { provinceId: id, troops: 0, ownerName: null });
                        }
                    });
                    player.troops = refund;
                    socket.emit("troops_remaining", { troopsToPlaceLeft: player.troops });
                    socket.emit("error", { message: "Devi piazzare almeno una truppa in ogni provincia" });
                    return;
                }
            }
            room.placementDone.add(socket.id);
            console.log("[place_troop] placementDone size:", room.placementDone.size);
            if (room.placementDone.size === room.turnOrderDetails.length) {
                io.to(roomId).emit("placement_complete");
                io.to(roomId).emit("turn", {
                    currentPlayerId: room.turnOrder[room.currentTurnIndex],
                    turnOrder: room.turnOrderDetails
                });
            }
        }
    });

    socket.on("roll_for_tie", (payload = {}) => {
        const roomId = String(payload.roomId || socket.request?.session?.roomId || "");
        let room = rooms.get(roomId);
        if (!room) return;
        if (!room.currentTiedGroup?.includes(socket.id)) return;
        if (room.turnOrderRolls[socket.id]) return;
        const roll = Math.floor(Math.random() * 6) + 1;
        room.turnOrderRolls[socket.id] = roll;
        const playerName = socket.request.session.userName || socket.id;
        io.to(roomId).emit("player_rolled", { socketId: socket.id, name: playerName, roll });
        if (Object.keys(room.turnOrderRolls).length < room.currentTiedGroup.length) return;

        const allRolls = { ...room.turnOrderRolls };
        const groups = {};
        for (const [id, r] of Object.entries(allRolls)) {
            if (!groups[r]) groups[r] = [];
            groups[r].push(id);
        }
        const stillTied = Object.entries(groups).filter(([, ids]) => ids.length > 1);
        const resolved = Object.entries(groups).filter(([, ids]) => ids.length === 1);
        for (const [roll, [socketId]] of resolved.sort(([a], [b]) => Number(b) - Number(a))) {
            const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
            const continent = Array.from(room.selectedContinents.entries()).find(([, n]) => n === name)?.[0] || "";
            room.resolvedOrder.push({ socketId, name, continent, roll: Number(roll) });
        }
        if (stillTied.length > 0) {
            const [tiedRoll, tiedIds] = stillTied[0];
            const tiedPlayers = tiedIds.map(socketId => {
                const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
                return { socketId, name };
            });
            room.currentTiedGroup = tiedIds;
            room.turnOrderRolls = {};
            io.to(roomId).emit("tie_detected", {
                tiedPlayers,
                tiedRoll: Number(tiedRoll),
                allRolls: Object.fromEntries(Object.entries(allRolls).map(([id, r]) => {
                    const name = io.sockets.sockets.get(id)?.request?.session?.userName || id;
                    return [id, { name, roll: r }];
                }))
            });
            return;
        }
        if (room.pendingTiedGroups?.length > 0) {
            const [nextRoll, nextIds] = room.pendingTiedGroups.shift();
            const tiedPlayers = nextIds.map(socketId => {
                const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
                return { socketId, name };
            });
            room.currentTiedGroup = nextIds;
            room.turnOrderRolls = {};
            io.to(roomId).emit("tie_detected", { tiedPlayers, tiedRoll: Number(nextRoll), allRolls: {} });
            return;
        }
        finalizeTurnOrder(room, roomId, io, {});
    });

    socket.on("get_game_state", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || !room.gameStarted) return;

        const playerDetail = room.turnOrderDetails?.find(p => p.socketId === socket.id);
        if (!playerDetail) return;

        // Rimanda tutte le province
        if (room.provinces) {
            for (const [provinceId, province] of Object.entries(room.provinces)) {
                socket.emit("province_updated", {
                    provinceId,
                    troops: province.troops,
                    ownerName: province.owner || null,
                    noMansLand: province.noMansLand || false
                });
            }
        }

        // Rimanda il turn order (aggiorna pp-continent, pp-name ecc.)
        socket.emit("turn_order_decided", {
            turnOrder: room.turnOrderDetails,
            playerContinents: Object.fromEntries(room.selectedContinents),
        });

        // Rimanda il turno corrente
        socket.emit("turn", {
            currentPlayerId: room.turnOrder[room.currentTurnIndex],
            turnOrder: room.turnOrderDetails
        });

        // Se il player è ancora in fase placement
        if (playerDetail.troops > 0 && room.placementDone && !room.placementDone.has(socket.id)) {
            socket.emit("placement_start", { troops: playerDetail.troops });
        }

        // Timer di gioco
        if (room.gameTimerEnd && !room.gameEnded) {
            socket.emit("game_timer_start", { endTime: room.gameTimerEnd, serverTime: Date.now() });
        }

        // Se è stato eliminato
        if (playerDetail.defeated) {
            socket.emit("defeated", { roomId });
        }
    });

    socket.on("check_turn_order_status", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const isDecided = !!room.turnOrder && room.turnOrder.length > 0;
        socket.emit("turn_order_status", { isDecided, turnOrder: room.turnOrder || [] });
    });

    socket.on("end_turn", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;
        let nextIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
        let attempts = 0;
        while (attempts < room.turnOrder.length) {
            const nextPlayer = room.turnOrderDetails.find(p => p.socketId === room.turnOrder[nextIndex]);
            if (!nextPlayer || !nextPlayer.defeated) break;
            nextIndex = (nextIndex + 1) % room.turnOrder.length;
            attempts++;
        }
        room.currentTurnIndex = nextIndex;
        if (room.currentTurnIndex === 0) {
            room.turnCount++;
            if (room.turnCount % 3 === 0) {
                room.placementDone = new Set();
                room.turnOrderRolls = {};
                room.isRollingForTroops = true;
                room.troopRolls = {};
                // Only active (non-defeated) players roll for troops — spectators are excluded
                const activeForTroopRoll = room.turnOrderDetails.filter(p => !p.defeated);
                activeForTroopRoll.forEach(p => {
                    const s = io.sockets.sockets.get(p.socketId);
                    if (s) s.emit("troop_roll_start");
                });
            }
        }
        io.to(roomId).emit("turn", {
            currentPlayerId: room.turnOrder[room.currentTurnIndex],
            turnOrder: room.turnOrderDetails
        });
    });

    socket.on("roll_for_troops", ({ roomId, roll }) => {
        const room = rooms.get(roomId);
        if (!room || !room.troopRolls) return;
        const player = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!player || player.defeated) return;
        if (room.troopRolls[socket.id]) return;
        room.troopRolls[socket.id] = roll;
        const playerName = socket.request.session.userName;
        io.to(roomId).emit("player_troop_rolled", { socketId: socket.id, name: playerName, roll });
        const activePlayers = room.turnOrderDetails.filter(p => !p.defeated);
        if (Object.keys(room.troopRolls).length === activePlayers.length) {
            activePlayers.forEach(player => {
                const r = room.troopRolls[player.socketId];
                const newTroops = troopAssignment(r, player.troops);
                if (newTroops !== null) player.troops = newTroops;
            });
            activePlayers.forEach(player => {
                const s = io.sockets.sockets.get(player.socketId);
                if (s) s.emit("placement_start", { troops: player.troops });
            });
            delete room.troopRolls;
            room.isRollingForTroops = false;
        }
    });
});

function processTurnOrderRolls(room, roomId, io) {
    const allRolls = { ...room.turnOrderRolls };
    const groups = {};
    for (const [socketId, roll] of Object.entries(allRolls)) {
        if (!groups[roll]) groups[roll] = [];
        groups[roll].push(socketId);
    }
    const tiedGroups = Object.entries(groups).filter(([, ids]) => ids.length > 1);
    if (tiedGroups.length > 0) {
        if (!room.resolvedOrder) room.resolvedOrder = [];
        const soloEntries = Object.entries(groups)
            .filter(([, ids]) => ids.length === 1)
            .sort(([a], [b]) => Number(b) - Number(a));
        for (const [roll, [socketId]] of soloEntries) {
            const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
            const continent = Array.from(room.selectedContinents.entries()).find(([, n]) => n === name)?.[0] || "";
            room.resolvedOrder.push({ socketId, name, continent, roll: Number(roll) });
        }
        const sortedTiedGroups = tiedGroups.sort(([a], [b]) => Number(b) - Number(a));
        const [tiedRoll, tiedIds] = sortedTiedGroups[0];
        const tiedPlayers = tiedIds.map(socketId => {
            const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
            return { socketId, name };
        });
        room.pendingTiedGroups = sortedTiedGroups.slice(1);
        room.currentTiedGroup = tiedIds;
        room.turnOrderRolls = {};
        io.to(roomId).emit("tie_detected", {
            tiedPlayers,
            tiedRoll: Number(tiedRoll),
            allRolls: Object.fromEntries(Object.entries(allRolls).map(([id, r]) => {
                const name = io.sockets.sockets.get(id)?.request?.session?.userName || id;
                return [id, { name, roll: r }];
            }))
        });
        return;
    }
    finalizeTurnOrder(room, roomId, io, allRolls);
}

function finalizeTurnOrder(room, roomId, io, allRolls) {
    const resolved = room.resolvedOrder || [];
    for (const [socketId, roll] of Object.entries(allRolls)) {
        if (!resolved.find(p => p.socketId === socketId)) {
            const name = io.sockets.sockets.get(socketId)?.request?.session?.userName || socketId;
            const continent = Array.from(room.selectedContinents.entries()).find(([, n]) => n === name)?.[0] || "";
            resolved.push({ socketId, name, continent, roll });
        }
    }
    const turnOrderDetails = resolved.map(p => ({
        ...p,
        troops: troopAssignment(p.roll, 0)
    }));
    room.turnOrder = turnOrderDetails.map(p => p.socketId);
    room.turnOrderDetails = turnOrderDetails;
    room.currentTurnIndex = 0;
    room.turnCount = 0;
    room.isRollingForTroops = false;
    room.turnOrderRolls = {};
    room.resolvedOrder = null;
    room.pendingTiedGroups = null;
    room.currentTiedGroup = null;
    room.defeatedOrder = []; // reset for new game
    io.to(roomId).emit("turn_order_decided", {
        turnOrder: turnOrderDetails,
        playerContinents: Object.fromEntries(room.selectedContinents),
    });
    room.placementDone = new Set();
    room.provinces = {};
    room.turnOrderDetails.forEach(player => {
        const playerSocket = io.sockets.sockets.get(player.socketId);
        if (playerSocket) playerSocket.emit("placement_start", { troops: player.troops });
    });
}

function rollDice(numDice) {
    const dices = [];
    for (let i = 0; i < numDice; i++) dices.push(Math.floor(Math.random() * 6) + 1);
    return dices;
}

function getProvinceCountByOwner(room) {
    const count = {};
    for (const province of Object.values(room.provinces || {})) {
        if (province.owner && !province.noMansLand) {
            count[province.owner] = (count[province.owner] || 0) + 1;
        }
    }
    return count;
}

function getTroopsTotalByOwner(room) {
    const total = {};
    for (const province of Object.values(room.provinces || {})) {
        if (province.owner && province.troops > 0 && !province.noMansLand) {
            total[province.owner] = (total[province.owner] || 0) + province.troops;
        }
    }
    return total;
}

function buildGameResults(room) {
    const provinceCount = getProvinceCountByOwner(room);

    // Active (non-defeated) players sorted by province count desc
    const activePlayers = (room.turnOrderDetails || [])
        .filter(p => !p.defeated)
        .map(player => ({
            socketId: player.socketId,
            name: player.name,
            provinces: provinceCount[player.name] || 0,
            troops: player.troops || 0,
            defeatedAt: null
        }))
        .sort((a, b) => {
            if (b.provinces !== a.provinces) return b.provinces - a.provinces;
            if (b.troops !== a.troops) return b.troops - a.troops;
            return a.name.localeCompare(b.name);
        });

    // Defeated players: defeatedOrder is ordered first-eliminated first
    // In ranking: last place = first eliminated, so we reverse for display
    const defeatedPlayers = (room.defeatedOrder || []).map(entry => ({
        socketId: entry.socketId,
        name: entry.name,
        provinces: 0,
        troops: 0,
        defeatedAt: entry.order
    }));
    // defeatedOrder[0] = first to die = last in ranking
    // We reverse so that the most recently eliminated is placed just after active players
    const defeatedSorted = [...defeatedPlayers].reverse();

    const players = [...activePlayers, ...defeatedSorted];

    return {
        players,
        endedAt: Date.now(),
        totalProvinces: Object.keys(provinces).length
    };
}

function clearEndGameTimer(room) {
    if (room && room.endGameTimeout) {
        clearTimeout(room.endGameTimeout);
        room.endGameTimeout = null;
        room.gameTimerEnd = null;
    }
}

function concludeGame(roomId, reason = "time") {
    const room = rooms.get(roomId);
    if (!room || room.gameEnded) return;
    clearEndGameTimer(room);
    room.gameEnded = true;
    room.gameResults = { ...buildGameResults(room), reason };
    io.to(roomId).emit("game_over", { roomId, results: room.gameResults });
}

function removeDefeatedPlayers(room, roomId, io) {
    if (!room || room.gameEnded) return;
    const provinceCount = getProvinceCountByOwner(room);
    const defeated = room.turnOrderDetails.filter(player =>
        !player.defeated && (provinceCount[player.name] || 0) === 0
    );
    if (defeated.length === 0) return;

    defeated.forEach(player => {
        player.defeated = true;
        // Record elimination order
        if (!room.defeatedOrder) room.defeatedOrder = [];
        room.defeatedOrder.push({
            socketId: player.socketId,
            name: player.name,
            order: room.defeatedOrder.length // 0 = first eliminated
        });
        const socket = io.sockets.sockets.get(player.socketId);
        if (socket) {
            socket.emit("defeated", { roomId });
        }
    });

    const activePlayers = room.turnOrderDetails.filter(p => !p.defeated);
    if (activePlayers.length <= 1) {
        concludeGame(roomId, "conquest");
        return;
    }

    // If the current player was defeated, advance to the next turn
    const currentPlayer = room.turnOrder[room.currentTurnIndex];
    const currentPlayerDetail = room.turnOrderDetails.find(p => p.socketId === currentPlayer);
    if (currentPlayerDetail && currentPlayerDetail.defeated) {
        // Advance turn
        let nextIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
        let attempts = 0;
        while (attempts < room.turnOrder.length) {
            const nextPlayer = room.turnOrderDetails.find(p => p.socketId === room.turnOrder[nextIndex]);
            if (!nextPlayer || !nextPlayer.defeated) break;
            nextIndex = (nextIndex + 1) % room.turnOrder.length;
            attempts++;
        }
        room.currentTurnIndex = nextIndex;
    }

    io.to(roomId).emit("turn", {
        currentPlayerId: room.turnOrder[room.currentTurnIndex],
        turnOrder: room.turnOrderDetails
    });
}

function checkVictoryCondition(room, roomId) {
    if (!room || room.gameEnded) return false;
    const provinceCount = getProvinceCountByOwner(room);
    const activePlayers = room.turnOrderDetails.filter(p => !p.defeated);
    for (const player of activePlayers) {
        if ((provinceCount[player.name] || 0) === Object.keys(provinces).length) {
            concludeGame(roomId, "conquest");
            return true;
        }
    }
    return false;
}

httpServer.listen(3000, () => {
    console.log("Server listening on http://localhost:3000");
});

function clearDeleteTimer(roomId) {
    const t = deleteTimers.get(roomId);
    if (t) {
        clearTimeout(t);
        deleteTimers.delete(t);
        debugRooms(`clearDeleteTimer ${roomId}`);
    }
}

function scheduleDeleteRoom(roomId) {
    clearDeleteTimer(roomId);
    const timer = setTimeout(() => {
        const room = rooms.get(roomId);
        if (!room || room.players.length > 0) return;
        rooms.delete(roomId);
        deleteTimers.delete(roomId);
        io.emit("rooms_updated");
        debugRooms(`rooms.delete(${roomId}) timeout`);
    }, 5000);
    deleteTimers.set(roomId, timer);
}

function troopAssignment(roll, playerTroops) {
    switch (roll) {
        case 1: case 2: return playerTroops + 4;
        case 3: case 4: return playerTroops + 5;
        case 5: return playerTroops + 6;
        case 6: return playerTroops + 7;
        default:
            console.warn("Roll non disponibile per assegnazione truppe");
            return null;
    }
}