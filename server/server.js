const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/view/home.html"));
});

const MAX_ROOMS = 3;

function generateRoomId() {
    for (let i = 1; i <= MAX_ROOMS; i++) {
        if (!io.of("/").adapter.rooms.has(String(i))) {
            return String(i);
        }
    }
    return null;
}

function getRooms() {
    const rooms = [];
    io.of("/").adapter.rooms.forEach((sockets, roomId) => {
        if (!io.of("/").sockets.has(roomId)) {
            rooms.push({ id: roomId, players: sockets.size });
        }
    });
    return rooms;
}

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");

    socket.on("get_rooms", () => {
        socket.emit("rooms_list", getRooms());
    });

    socket.on("create_room", () => {
        const room_id = generateRoomId();

        if (room_id === null) {
            socket.emit("error", { message: "Numero massimo di stanze raggiunto" });
            return;
        }

        socket.join(room_id);
        socket.emit("room_created", { roomId: room_id });
        io.emit("rooms_updated");
    });

    socket.on("join_room", (roomId) => {
        if (!io.of("/").adapter.rooms.has(roomId)) {
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }
        socket.join(roomId);
        socket.emit("room_joined", { roomId });
        io.emit("rooms_updated");
    });

    socket.on("edit_room", (data) => {
        const { room_name, map_id } = data;
        console.log(`Stanza modificata: nome=${room_name}, mappa=${map_id}`);
    });

    socket.on("disconnect", () => {
        setTimeout(() => {
            io.emit("rooms_updated");
        }, 100);
    });
});

httpServer.listen(3000, () => {
    console.log("Server in ascolto su http://localhost:3000");
});