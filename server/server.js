const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

const rooms = new Map();

/*

rooms = {
    "RoomID", {
        room_code: "Codice univoco per entrare nella stanza",
        map_id: "ID della mappa",
        players: ["Player1", "Player2", ...]
     }
}

*/

app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../client/view/home.html"));
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

function generateRoomCode()  {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    return roomCode;
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
        const roomCode = generateRoomCode();
        //da aggiungere funzione per la selezione mappa

        if (roomId === null) {
            socket.emit("error", { message: "Numero massimo di stanze raggiunto" });
            return;
        }

        socket.join(roomId);
        socket.emit("room_created", { roomId: roomId, roomCode: roomCode, isHost: true });
        io.emit("rooms_updated");

        // aggiungi la stanza alla mappa room
        rooms.set(roomId, {
            room_code: roomCode,
            map_id: null,
            players: [socket.id]
            host : socket.id
        });
    });

    socket.on("join_room", (roomId, roomCode) => {
        if (!io.of("/").adapter.rooms.has(roomId)) {
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }
        else if(rooms.get(roomId).room_code === roomCode) {
            if (rooms.get(roomId).players.length >= 4) {
                socket.emit("error", { message: "Stanza piena" });
                return;
            }

            socket.join(roomId);
            socket.emit("room_joined", { roomId });
            rooms.get(roomId).players.push(socket.id)
            io.emit("rooms_updated");
            
        }
        else {
            socket.emit("error", { message: "Codice stanza errato" });
        }
    });

    socket.on("edit_room_name", (roomName, roomId) => {
        const room = rooms.get(roomId);
        room.room_name = roomName;
        io.emit("rooms_updated");
    });

    socket.on("disconnect", () => {
    rooms.forEach((room, roomId) => {
        if (room.players.includes(socket.id)) {
            room.players = room.players.filter(p => p !== socket.id);
            if (room.players.length === 0) {
                setTimeout(() => {
                    if (rooms.has(roomId) && rooms.get(roomId).players.length === 0) {
                        rooms.delete(roomId);
                        io.emit("rooms_updated");
                    }
                }, 5000); // aspetta 5 secondi prima di cancellare
                return;
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