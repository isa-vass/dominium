//const { io } = require("socket.io-client");
const socket = io('http://localhost:3000');

//socket.emit("connection");

socket.on("welcome", (msg) => {
    console.log('msg', msg);

    socket.emit("create_room");
})

//gestione bottoni home.html
const btnStart = document.getElementById("btn-start");
const btnCredits = document.getElementById("btn-credits");

if (btnStart) {
    btnStart.addEventListener("click", () => {
        window.location.href = "/view/action.html";
    });
}

if (btnCredits) {
    btnCredits.addEventListener("click", () => {
        window.location.href = "/view/credits.html";
    });
}

socket.on("room_created", (data) => {
    console.log("Stanza creata con ID:", data.roomId);
})