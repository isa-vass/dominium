const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");

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
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/view/home.html"));
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
            ready: room.readyPlayers?.has(socketId) || false,
            isHost: room.host === socketId
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
            host: socket.id,
            players: [socket.id],
            readyPlayers: new Set()
        });

        socket.join(roomId);
        socket.request.session.roomId = roomId;
        socket.request.session.isHost = true;
        socket.request.session.save((err) => {
            if (err) console.error("[CREATE] Errore salvataggio sessione:", err);
            socket.emit("room_created", { roomId, roomCode, isHost: true });
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
        socket.request.session.isHost = false;

        socket.request.session.save((err) => {
            if (err) console.error("[JOIN] Errore salvataggio sessione:", err);
            socket.emit("room_joined", { roomId, isHost: false });
            io.emit("rooms_updated");
            emitPlayersUpdated(roomId);
        });
    });

    socket.on("rejoin_room", ({ roomId, isHost } = {}) => {
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        for (const key of [`host_${roomId}`, roomId]) {
            if (deleteTimers.has(key)) {
                clearTimeout(deleteTimers.get(key));
                deleteTimers.delete(key);
            }
        }

        if (isHost) room.host = socket.id;

        if (!room.players.includes(socket.id)) {
            room.players.push(socket.id);
        }

        if (!room.readyPlayers) room.readyPlayers = new Set();

        socket.join(roomId);
        socket.emit("rejoined", { roomId, isHost: room.host === socket.id });
        io.emit("rooms_updated");
        emitPlayersUpdated(roomId);
    });

    socket.on("player_ready", ({ roomId, ready }) => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (!room.readyPlayers) room.readyPlayers = new Set();

        if (ready) {
            room.readyPlayers.add(socket.id);
        } else {
            room.readyPlayers.delete(socket.id);
        }

        emitPlayersUpdated(roomId);
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

        const isHost = room.host === socket.id;
        room.players = room.players.filter(p => p !== socket.id);
        room.readyPlayers?.delete(socket.id);

        if (isHost) {
            io.to(roomId).emit("host_left");
            rooms.delete(roomId);
            io.emit("rooms_updated");
        } else {
            emitPlayersUpdated(roomId);
            io.emit("rooms_updated");
        }

        socket.request.session.roomId = null;
        socket.request.session.isHost = false;
        socket.request.session.save();
    });

    socket.on("disconnect", () => {
        rooms.forEach((room, roomId) => {
            if (!room.players.includes(socket.id)) return;

            const isHost = room.host === socket.id;
            room.players = room.players.filter(p => p !== socket.id);
            room.readyPlayers?.delete(socket.id);

            if (isHost) {
                const oldSocketId = socket.id;
                const timer = setTimeout(() => {
                    const currentRoom = rooms.get(roomId);
                    if (currentRoom && currentRoom.host === oldSocketId) {
                        io.to(roomId).emit("host_left");
                        rooms.delete(roomId);
                        io.emit("rooms_updated");
                    }
                }, 3000);
                deleteTimers.set(`host_${roomId}`, timer);
            } else {
                emitPlayersUpdated(roomId);
                if (room.players.length === 0) {
                    const timer = setTimeout(() => {
                        if (rooms.has(roomId) && rooms.get(roomId).players.length === 0) {
                            rooms.delete(roomId);
                            io.emit("rooms_updated");
                        }
                    }, 5000);
                    deleteTimers.set(roomId, timer);
                }
            }
        });

        setTimeout(() => {
            io.emit("rooms_updated");
        }, 100);
    });

// --- GAME LOGIC ---
    socket.on("win_chance", ({ attackerTroops, defenderTroops }) => {
        const winner = resolveBattle(attackerTroops, defenderTroops);

        socket.emit("battle_result", { winner });
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