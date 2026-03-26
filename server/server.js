const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
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

        if (ready && !Array.from(room.selectedContinents.values()).includes(socket.id)) {
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
                room.gameCountdown = null;
            }, 3000);
        }
    });

    socket.on("select_continent", ({ roomId, continent }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        // Rimuovi selezione precedente di questo giocatore
        for (const [cont, playerId] of room.selectedContinents) {
            if (playerId === socket.id) {
                room.selectedContinents.delete(cont);
            }
        }

        // Se il continente non è già selezionato da qualcun altro, selezionalo
        if (!room.selectedContinents.has(continent)) {
            room.selectedContinents.set(continent, socket.id);
        }

        // Notifica tutti i giocatori nella stanza con il loro rispettivo ID
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

        // Rimuovi selezioni continenti del giocatore
        for (const [continent, playerId] of room.selectedContinents) {
            if (playerId === socket.id) {
                room.selectedContinents.delete(continent);
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
        socket.request.session.save(() => {});

        if (!room.turnOrderRolls) room.turnOrderRolls = {};
        if (room.turnOrderRolls[socket.id]) return;

        const roll = Math.floor(Math.random() * 6) + 1;
        room.turnOrderRolls[socket.id] = roll;

        const playerName = io.sockets.sockets.get(socket.id)?.request?.session?.userName || socket.id;
        io.to(effectiveRoomId).emit("player_rolled", { socketId: socket.id, name: playerName, roll });

        const totalPlayers = room.players.length;
        const totalRolled = Object.keys(room.turnOrderRolls).length; //conta quantio giocatori hanno già tirato 

        if (totalRolled === totalPlayers) {
            // Ordina per dado decrescente, in caso di parità ri-tira
            const sorted = Object.entries(room.turnOrderRolls)
                .sort(([, a], [, b]) => b - a);

            // Gestisci i pareggi: i giocatori con lo stesso valore tirano di nuovo
            const topScore = sorted[0][1];
            const tied = sorted.filter(([, v]) => v === topScore);

            if (tied.length > 1) {
                // Reset solo per i pareggiati
                tied.forEach(([id]) => delete room.turnOrderRolls[id]);
                const tiedNames = tied.map(([id]) =>
                    io.sockets.sockets.get(id)?.request?.session?.userName || id
                );
                io.to(effectiveRoomId).emit("turn_order_tie", {
                    tiedPlayerIds: tied.map(([id]) => id),
                    tiedNames
                });
                return;
            }

            // Ordine finale
            const turnOrder = sorted.map(([id]) => {
                const name = io.sockets.sockets.get(id)?.request?.session?.userName || id;
                const continent = Array.from(room.selectedContinents.entries())
                    .find(([, socketId]) => socketId === id)?.[0] || "";
                return { socketId: id, name, continent };
            });

            room.turnOrder = turnOrder.map(p => p.socketId);
            room.currentTurnIndex = 0;
            room.turnOrderRolls = {}; // pulizia

            // Nuova emissione indispensabile
            io.to(effectiveRoomId).emit("turn_order_decided", {
                turnOrder,
                playerContinents: Object.fromEntries(room.selectedContinents)
            });
        }
    });

    socket.on("check_turn_order_status", ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        // Ritorna true se i turni sono già stati decisi
        const isDecided = !!room.turnOrder && room.turnOrder.length > 0;
        socket.emit("turn_order_status", { isDecided, turnOrder: room.turnOrder || [] });
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
        deleteTimers.delete(roomId);
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