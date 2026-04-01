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

// Costruisce la lista giocatori con nomi da mandare al client
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

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");

    socket.emit("provinces_data", provinces);

    socket.on("set_name", (name) => {
        if (!name || typeof name !== "string") return;
        socket.request.session.userName = name.trim().substring(0, 20);
        socket.request.session.save(() => {
            // Aggiorna la lista giocatori nella stanza se è già dentro
            const roomId = socket.request.session.roomId;
            if (roomId) emitPlayersUpdated(roomId);
        });
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
            selectedContinents: new Map(), // continente -> socketId
            gameCountdown: null // timer per il countdown di inizio gioco
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

        if (!room) {
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }

        if (room.room_code !== roomCode.toUpperCase()) {
            socket.emit("error", { message: "Codice stanza errato" });
            return;
        }

        if (room.players.length >= 4) {
            socket.emit("error", { message: "Stanza piena" });
            return;
        }

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

            // Notifica continenti selezionati a tutti i giocatori
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

        if (!room.players.includes(socket.id)) {
            room.players.push(socket.id);
        }

        if (!room.readyPlayers) room.readyPlayers = new Set();

        socket.join(roomId);
        socket.emit("rejoined", { roomId });
        io.emit("rooms_updated");
        emitPlayersUpdated(roomId);

        // Notifica continenti selezionati a tutti i giocatori
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
            // Se qualcuno si "unready", cancella il countdown se attivo
            if (room.gameCountdown) {
                clearTimeout(room.gameCountdown);
                room.gameCountdown = null;
                io.to(roomId).emit("countdown_stop");
            }
        }

        emitPlayersUpdated(roomId);

        // Controlla se tutti i 4 giocatori sono pronti
        if (room.players.length === 4 && room.readyPlayers.size === 4) {
            ///////////////////////4
            // Avvia countdown di 3 secondi
            io.to(roomId).emit("game_countdown_start", { seconds: 3 });

            room.gameCountdown = setTimeout(() => {
                // Alla fine del countdown, avvia il gioco
                io.to(roomId).emit("game_start");
                room.isRollingForTroops = true;
                room.gameStarted = true;
                room.gameCountdown = null;
            }, 3000);
        }
    });

    socket.on("select_continent", ({ roomId, continent }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const playerName = socket.request.session.userName;
        console.log("[select_continent] playerName:", playerName, "continent:", continent);

        // Rimuovi selezione precedente di questo giocatore
        for (const [cont, name] of room.selectedContinents) {
            if (name === playerName) {
                room.selectedContinents.delete(cont);
            }
        }

        if (!room.selectedContinents.has(continent)) {
            room.selectedContinents.set(continent, playerName);
        }

        socket.request.session.selectedContinent = continent;
        socket.request.session.save();

        // Notifica tutti
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
        console.log("[select_continent] dopo set:", Object.fromEntries(room.selectedContinents));
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

        room.players = room.players.filter(p => p !== socket.id);
        room.readyPlayers?.delete(socket.id);

        // Cancella countdown se attivo
        if (room.gameCountdown) {
            clearTimeout(room.gameCountdown);
            room.gameCountdown = null;
            io.to(roomId).emit("countdown_stop");
        }

        if (!room.gameStarted) {
            const leavingName = socket.request.session.userName;
            for (const [continent, name] of room.selectedContinents) {
                if (name === leavingName) {
                    room.selectedContinents.delete(continent);
                }
            }
        }

        // Se nessuno rimane nella stanza, elimina la stanza
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
            room.players = room.players.filter(p => p !== socket.id);
            room.readyPlayers?.delete(socket.id);

            // Cancella countdown se attivo
            if (room.gameCountdown) {
                clearTimeout(room.gameCountdown);
                room.gameCountdown = null;
                io.to(roomId).emit("countdown_stop");
            }

            // Rimuovi selezioni continenti del giocatore
            for (const [continent, playerId] of room.selectedContinents) {
                if (playerId === socket.id) {
                    room.selectedContinents.delete(continent);
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

        // verifica che sia il turno del giocatore
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;

        const player = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!player) return;

        // la provincia attaccante deve essere tua e avere almeno 2 truppe
        const attacker = room.provinces[provinceId];
        if (!attacker || attacker.owner !== socket.id) return;
        if (attacker.troops < 1) {
            socket.emit("error", { message: "You need at least 1 troop to attack" });
            return;
        }

        const neighbors = borders[provinceId] || [];
        const attackable = neighbors.filter(id => {
            const p = room.provinces[id];
            // attaccabile se esiste ed è di qualcun altro
            return p && p.owner && p.owner !== socket.id;
        });

        socket.emit("attackable_provinces", { fromProvinceId: provinceId, attackable });
    });

    socket.on("attack", ({ fromProvinceId, toProvinceId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        // controlli di sicurezza
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;

        const attacker = room.provinces[fromProvinceId];
        const defender = room.provinces[toProvinceId];

        if (!attacker || !defender) return;
        if (attacker.owner !== socket.id) return;
        if (defender.owner === socket.id) return;
        if (attacker.troops < 1) {
            socket.emit("error", { message: "You need at least 1 troop to attack" });
            return;
        }

        // verifica adiacenza
        const neighbors = borders[fromProvinceId] || [];
        if (!neighbors.includes(toProvinceId)) {
            socket.emit("error", { message: "Province non confinanti" });
            return;
        }

        const winner = resolveBattle(attacker.troops, defender.troops);
        const defenderSocketId = defender.owner;

        if (winner === "attacker") {
            // l'attaccante conquista: sposta tutte le truppe tranne 1
            const movingTroops = attacker.troops - 1;
            attacker.troops = 1;
            defender.troops = movingTroops;
            defender.owner = socket.id;

            // aggiorna il nome del proprietario per il client
            const attackerPlayer = room.turnOrderDetails.find(p => p.socketId === socket.id);
            const defenderPlayer = room.turnOrderDetails.find(p => p.socketId === defenderSocketId);

            io.to(roomId).emit("province_updated", {
                provinceId: fromProvinceId,
                troops: attacker.troops,
                ownerName: attackerPlayer?.name
            });
            io.to(roomId).emit("province_updated", {
                provinceId: toProvinceId,
                troops: defender.troops,
                ownerName: attackerPlayer?.name
            });
            io.to(roomId).emit("attack_result", {
                winner: "attacker",
                fromProvinceId,
                toProvinceId,
                attackerName: attackerPlayer?.name,
                defenderName: defenderPlayer?.name
            });
        } else {
            attacker.troops--;

            const attackerPlayer = room.turnOrderDetails.find(p => p.socketId === socket.id);
            const defenderPlayer = room.turnOrderDetails.find(p => p.socketId === defenderSocketId);

            if (attacker.troops <= 0) {
                // la provincia attaccante viene conquistata dal difensore
                attacker.owner = defenderPlayer?.name;
                attacker.troops = 1; // il difensore lascia 1 truppa

                io.to(roomId).emit("province_updated", {
                    provinceId: fromProvinceId,
                    troops: 1,
                    ownerName: defenderPlayer?.name
                });
            } else {
                io.to(roomId).emit("province_updated", {
                    provinceId: fromProvinceId,
                    troops: attacker.troops,
                    ownerName: attackerPlayer?.name
                });
            }

            io.to(roomId).emit("attack_result", {
                winner: "defender",
                fromProvinceId,
                toProvinceId,
                attackerName: attackerPlayer?.name,
                defenderName: defenderPlayer?.name,
                provinceConquered: attacker.troops <= 0 // flag opzionale per il client
            });
        }
    });

    socket.on("win_chance", ({ attackerTroops, defenderTroops }) => {
        const winner = resolveBattle(attackerTroops, defenderTroops);

        socket.emit("battle_result", { winner });
    });

    socket.on("roll_for_turn_order", (payload = {}) => {
        const roomId = String(payload.roomId || socket.request?.session?.roomId || "");
        debugRooms(`[roll_for_turn_order start] socket:${socket.id} payloadRoom:${payload.roomId} sessionRoom:${socket.request?.session?.roomId}`);
        console.log("[roll_for_turn_order] roomId:", roomId, "socketRooms:", Array.from(socket.rooms));

        let room = rooms.get(roomId);
        if (!room) {
            const fallbackRoom = Array.from(socket.rooms).find(r => r !== socket.id);
            if (fallbackRoom && rooms.has(fallbackRoom)) {
                room = rooms.get(fallbackRoom);
                console.log("[roll_for_turn_order] fallbackRoom:", fallbackRoom);
            }
        }

        if (!room) {
            console.error("[roll_for_turn_order] stanza non trovata", { roomId, socketRooms: Array.from(socket.rooms) });
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }

        const effectiveRoomId = roomId || Array.from(socket.rooms).find(r => r !== socket.id);
        socket.request.session.roomId = effectiveRoomId;
        socket.request.session.save(() => { });

        if (!room.turnOrderRolls) room.turnOrderRolls = {};

        // ── FIX 1: Ignora roll doppi solo se non è un pareggio in corso ──
        // Se il socket ha già tirato E non fa parte dei tiedPlayers attuali, ignora
        if (room.turnOrderRolls[socket.id]) {
            const isTied = room.tiedPlayers && room.tiedPlayers.includes(socket.id);
            if (!isTied) return;
        }

        const roll = Math.floor(Math.random() * 6) + 1;
        room.turnOrderRolls[socket.id] = roll;

        const playerName = socket.request.session.userName || socket.id;
        io.to(effectiveRoomId).emit("player_rolled", { socketId: socket.id, name: playerName, roll });

        // ── FIX 2: Usa tiedPlayers per sapere quanti devono tirare ──
        // Se c'è un pareggio in corso, aspetta solo i pareggiati; altrimenti tutti i giocatori
        const expectedPlayers = room.tiedPlayers || room.players;
        const totalPlayers = expectedPlayers.length;
        const totalRolled = expectedPlayers.filter(id => room.turnOrderRolls[id] !== undefined).length;

        if (totalRolled === totalPlayers) {
            try {
                if (room.isRollingForTroops) {
                    if (!room.previousRolls) room.previousRolls = {};

                    // Determina se siamo in un "re-roll" per le truppe aggiuntive (dopo il primo ordine)
                    const isTroopRefill = !!room.turnOrder && room.turnOrder.length > 0;

                    const allRolls = { ...room.turnOrderRolls };
                    const sorted = Object.entries(allRolls).sort(([, a], [, b]) => b - a);

                    if (!isTroopRefill) {
                        // === PRIMO LANCIO: stabilisce ordine turni ===
                        // Controlla pareggi
                        const scores = sorted.map(([, v]) => v);
                        const tiedScore = scores.find((score, i) => scores.indexOf(score) !== i);

                        if (tiedScore !== undefined) {
                            const tied = sorted.filter(([, v]) => v === tiedScore);
                            const notTied = sorted.filter(([, v]) => v !== tiedScore);
                            room.previousRolls = Object.fromEntries(notTied);
                            room.tiedPlayers = tied.map(([id]) => id);
                            room.turnOrderRolls = {};
                            const tiedNames = room.tiedPlayers.map(id =>
                                io.sockets.sockets.get(id)?.request?.session?.userName || id
                            );
                            io.to(effectiveRoomId).emit("turn_order_tie", {
                                tiedPlayerIds: room.tiedPlayers,
                                tiedNames
                            });
                            return;
                        }

                        // Nessun pareggio — ordine definitivo
                        const turnOrder = sorted.map(([id, roll]) => {
                            const name = io.sockets.sockets.get(id)?.request?.session?.userName || id;
                            const continent = Array.from(room.selectedContinents.entries())
                                .find(([, n]) => n === name)?.[0] || "";
                            return { socketId: id, name, continent, roll, troops: 0 };
                        });

                        turnOrder.forEach(player => {
                            player.troops = troopAssignment(player.roll, 0);
                        });

                        room.turnOrder = turnOrder.map(p => p.socketId);
                        room.turnOrderDetails = turnOrder;
                        room.currentTurnIndex = 0;
                        room.turnCount = 0;
                        room.isRollingForTroops = false;
                        room.turnOrderRolls = {};
                        room.tiedPlayers = null;
                        room.previousRolls = null;

                        io.to(effectiveRoomId).emit("turn_order_decided", {
                            turnOrder,
                            playerContinents: Object.fromEntries(room.selectedContinents),
                        });

                        room.placementDone = new Set();
                        room.provinces = {};
                        room.turnOrderDetails.forEach(player => {
                            const playerSocket = io.sockets.sockets.get(player.socketId);
                            if (playerSocket) {
                                playerSocket.emit("placement_start", { troops: player.troops });
                            }
                        });

                    } else {
                        // === LANCI SUCCESSIVI: solo aggiunta truppe, mantiene ordine esistente ===
                        // Nessun pareggio, nessun riordino — assegna truppe e basta
                        room.turnOrderDetails.forEach(player => {
                            const roll = allRolls[player.socketId];
                            if (roll !== undefined) {
                                const newTroops = troopAssignment(roll, 0); // parte sempre da 0, aggiungi le nuove
                                player.troops = (player.troops || 0) + newTroops;
                                const playerSocket = io.sockets.sockets.get(player.socketId);
                                if (playerSocket) {
                                    playerSocket.emit("placement_start", { troops: newTroops }); // manda solo le nuove
                                }
                            }
                        });

                        room.isRollingForTroops = false;
                        room.turnOrderRolls = {};
                        room.tiedPlayers = null;
                        room.previousRolls = null;
                        room.placementDone = new Set();

                        // Riprende dal turno corrente (non da 0)
                        io.to(effectiveRoomId).emit("turn", {
                            currentPlayerId: room.turnOrder[room.currentTurnIndex],
                            turnOrder: room.turnOrderDetails
                        });
                    }
                }
            }
            catch (e) {
                console.error("[roll_for_turn_order] Errore durante la decisione dell'ordine di turno:", e);
            }
        }
    });

    socket.on("place_troop", ({ provinceId, roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        const player = room.turnOrderDetails.find(p => p.socketId === socket.id);
        if (!player) return;

        const province = provinces[provinceId];
        if (!province || province.continent !== player.continent) {
            socket.emit("error", { message: "Non puoi piazzare truppe qui" });
            return;
        }

        if (player.troops <= 0) return;

        if (!room.provinces[provinceId]) {
            room.provinces[provinceId] = { troops: 0, owner: null };
        }
        room.provinces[provinceId].troops++;
        room.provinces[provinceId].owner = socket.id;
        player.troops--;

        io.to(roomId).emit("province_updated", {
            provinceId,
            troops: room.provinces[provinceId].troops,
            ownerName: player.name,
        });

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
                    // reset solo al primo piazzamento
                    let refund = 0;
                    continentProvinces.forEach(id => {
                        if (room.provinces[id]) {
                            refund += room.provinces[id].troops;
                            room.provinces[id].troops = 0;
                            room.provinces[id].owner = null;
                            io.to(roomId).emit("province_updated", {
                                provinceId: id, troops: 0, ownerName: null
                            });
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

    socket.on("check_turn_order_status", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        // Ritorna true se i turni sono già stati decisi
        const isDecided = !!room.turnOrder && room.turnOrder.length > 0;
        socket.emit("turn_order_status", { isDecided, turnOrder: room.turnOrder || [] });
    });

    socket.on("end_turn", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.turnOrder[room.currentTurnIndex] !== socket.id) return;

        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;

        if (room.currentTurnIndex === 0) {
            room.turnCount++;
            if (room.turnCount % 3 === 0) {
                room.placementDone = new Set();
                room.turnOrderRolls = {};
                room.isRollingForTroops = true;
                io.to(roomId).emit("troop_roll_start");
                return;
            }
        }

        io.to(roomId).emit("turn", {
            currentPlayerId: room.turnOrder[room.currentTurnIndex],
            turnOrder: room.turnOrderDetails
        });
    });
});

function resolveBattle(attackerTroops, defenderTroops) {
    if (attackerTroops > defenderTroops) {
        return "attacker";
    }

    if (defenderTroops > attackerTroops) {
        return "defender";
    }

    return Math.random() < 0.5 ? "attacker" : "defender";
}

httpServer.listen(3000, () => {
    console.log("Server in ascolto su http://localhost:3000");
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
    }, 5000); // o 10000
    deleteTimers.set(roomId, timer);
}

function troopAssignment(roll, playerTroops) {
    let totalTroops = playerTroops;
    let troopsAssigned = false;
    switch (roll) {
        case 1:
        case 2:
            totalTroops = playerTroops + 4;
            troopsAssigned = true;
            break;
        case 3:
        case 4:
            totalTroops = playerTroops + 5;
            troopsAssigned = true;
            break;
        case 5:
            totalTroops = playerTroops + 6;
            troopsAssigned = true;
            break;
        case 6:
            totalTroops = playerTroops + 7;
            troopsAssigned = true;
            break;
    }
    if (troopsAssigned) {
        console.log(`Truppe assegnate: ${totalTroops} (base: ${playerTroops}, roll: ${roll})`);
        return totalTroops;
    } else {
        console.warn("Roll non disponibile per assegnazione truppe");
        return null;
    }
}