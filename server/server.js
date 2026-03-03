const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

var rooms = new Map();

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
    var roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    return roomCode;
}

function getRooms() {
    const roomList = [];
    rooms.forEach((sockets, roomId) => {
        if (!io.of("/").sockets.has(roomId)) {
            roomList.push({ id: roomId, players: sockets.size });
        }
    });
    return roomList;
}

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");

    socket.on("get_rooms", () => {
        socket.emit("rooms_list", getRooms());
    });

    socket.on("create_room", () => {
        const room_id = generateRoomId();
        const room_code = generateRoomCode();
        //da aggiungere funzione per la selezione mappa

        if (room_id === null) {
            socket.emit("error", { message: "Numero massimo di stanze raggiunto" });
            return;
        }

        socket.join(room_id);
        socket.emit("room_created", { roomId: room_id, roomCode: room_code });
        io.emit("rooms_updated");

        // aggiungi la stanza alla mappa room
        rooms.set(room_id, {
            room_code: room_code,
            map_id: null,
            players: [socket.id]
        });
    });

    socket.on("join_room", (roomId, roomCode) => {
        if (!io.of("/").adapter.rooms.has(roomId)) {
            socket.emit("error", { message: "Stanza non trovata" });
            return;
        }
        if(rooms.get(roomId).room_code === roomCode) {
            socket.join(roomId);
            socket.emit("room_joined", { roomId });
            rooms.get(roomId).players.push(socket.id)
            io.emit("rooms_updated");
            
        }
        else {
            socket.emit("error", { message: "Codice stanza errato" });
        }
    });

    socket.on("edit_room", (data) => {
        const { room_name, map_id } = data;
        console.log(`Stanza modificata: nome=${room_name}, mappa=${map_id}`);
    });

    socket.on("disconnect", () => {
        rooms.forEach((room, roomId) => {
            if (room.players.includes(socket.id)) {
                room.players = room.players.filter(p => p !== socket.id); //Gestisci questione terre
                if (room.players.length === 0) {
                    rooms.delete(roomId);
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