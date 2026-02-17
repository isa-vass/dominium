const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

io.on("connection", (socket) => {
    socket.emit("welcome", "Welcome to Dominium!");

    socket.on("create_room", () => {
        var room_id = String((Math.floor(Math.random() * 3) + 1));  

        while(io.of("/").adapter.rooms .has(room_id))   {
            room_id = String((Math.floor(Math.random() * 3) + 1));  
        }

        socket.join(room_id);
        socket.emit("room_created",{ roomId: room_id });
    })
    
})


httpServer.listen(3000);
