const { io } = require("socket.io-client");
const socket = io('http://localhost:3000');

//socket.emit("connection");

socket.on("welcome", (msg) => {
    console.log('msg', msg);

    socket.emit("create_room");
})

socket.on("room_created", (data) => {
    console.log("Stanza creata con ID:", data.roomId);
})