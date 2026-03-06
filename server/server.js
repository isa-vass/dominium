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

/*
rooms = {
    "RoomID", {
        room_code: "Codice univoco per entrare nella stanza",
        map_id: "ID della mappa",
        host: "socket.id del creatore",
        players: ["socket.id1", "socket.id2", ...]
    }
}
*/

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

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");

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
            players: [socket.id]
        });

        socket.join(roomId);
        socket.request.session.roomId = roomId;
        socket.request.session.save();

        socket.emit("room_created", { roomId, roomCode, isHost: true });
        io.emit("rooms_updated");
    });

    socket.on("join_room", (roomId, roomCode) => {
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }

        if (room.room_code !== roomCode) {
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
        socket.request.session.save();

        // Log per vedere chi entra nella stanza
        console.log(`[JOIN] Socket ${socket.id} è entrato nella stanza ${roomId}`);
        console.log(`[ROOM ${roomId}] Giocatori ora presenti:`, room.players);

        socket.emit("room_joined", { roomId, isHost: false });
        io.emit("rooms_updated");
    });

    socket.on("rejoin_room", () => {
        console.log("rejoin_room chiamato da:", socket.id);
        const roomId = socket.request.session.roomId;
        console.log("rejoin chiamato, roomId:", roomId, "socket:", socket.id);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        if (deleteTimers.has(roomId)) {
            clearTimeout(deleteTimers.get(roomId));
            deleteTimers.delete(roomId);
        }

        if (!room.players.includes(socket.id)) {
            room.players.push(socket.id);
        }

        socket.join(roomId);
        io.emit("rooms_updated");
    });

    socket.on("edit_room_name", (roomName, roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;
        room.room_name = roomName;
        io.emit("rooms_updated");
    });

    socket.on("disconnect", () => {
        console.log("disconnect:", socket.id);
        rooms.forEach((room, roomId) => {
            if (!room.players.includes(socket.id)) return;

            const isHost = room.host === socket.id;

            room.players = room.players.filter(p => p !== socket.id);

            if (isHost) {
                // ✅ Aspetta prima di kickare: potrebbe essere un redirect/refresh
                const timer = setTimeout(() => {
                    const currentRoom = rooms.get(roomId);
                    // Se la stanza esiste ancora e l'host NON è tornato → kick reale
                    if (currentRoom && currentRoom.host === socket.id) {
                        console.log(`[HOST LEFT] L'host ${socket.id} ha lasciato la stanza ${roomId}. Kick di tutti i giocatori.`);
                        io.to(roomId).emit("host_left");
                        rooms.delete(roomId);
                        io.emit("rooms_updated");
                    }
                }, 3000); // 3 secondi di grazia per il rejoin
                deleteTimers.set(`host_${roomId}`, timer);

            } else {
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
});

httpServer.listen(3000, () => {
    console.log("Server in ascolto su http://localhost:3000");
});