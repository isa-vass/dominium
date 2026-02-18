const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {});

app.use(express.static(path.join(__dirname, "../client"))); //rende disponibile al browser tutti i file in /client

app.get("/", (req, res) => { //richiesta get, manda il file home.html
    res.sendFile(path.join(__dirname, "../client/view/home.html"));
});

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
