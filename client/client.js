const socket = io();

// HOME PAGE 
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

// ACTION PAGE 
const selectionCard = document.getElementById("selection-card-rooms");
const selectionCardJoin = document.getElementById("selection-card-join");
const btnCreate = document.getElementById("btn-create");
const buttonGroup = document.querySelector(".button-group");

function renderRooms(rooms) {
    if (!selectionCard) return;

    selectionCard.innerHTML = "<h2> ROOMS </h2>";

    if (rooms.length === 0) {
        selectionCard.innerHTML += "<p class='no-rooms'>Nessuna stanza disponibile</p>";
        return;
    }

    rooms.forEach((room) => {
        const roomEl = document.createElement("div");
        roomEl.classList.add("room-item");
        roomEl.innerHTML = `<span class="room-name">Stanza <strong>${room.id}</strong></span>`;

        roomEl.addEventListener("click", () => {
            selectRoom(room.id);
        });

        selectionCard.appendChild(roomEl);
    });
}

function selectRoom(roomId) {
    buttonGroup.style.display = "none";

    selectionCardJoin.innerHTML = `
        <h2>JOIN</h2>
        <label class="join-label">INSERT THE ROOM CODE</label>
        <input type="text" class="join-input" id="room-code-input" />
        <button class="btn btn-primary" id="btn-join">JOIN</button>
    `;

    document.getElementById("btn-join").addEventListener("click", () => {
        const roomCode = document.getElementById("room-code-input").value.trim();
        if (roomCode) socket.emit("join_room", roomId, roomCode);
        window.location.href = "/view/room.html?id=" + roomId;
    });
}

if (selectionCard) {
    socket.emit("get_rooms");

    socket.on("rooms_list", (rooms) => {
        renderRooms(rooms);
    });

    socket.on("rooms_updated", () => {
        socket.emit("get_rooms");
    });
}

if (btnCreate) {
    btnCreate.addEventListener("click", () => {
        socket.emit("create_room");
    });
}

socket.on("room_created", ({ roomId, roomCode, isHost }) => {
    sessionStorage.setItem("roomId", roomId);
    sessionStorage.setItem("roomCode", roomCode);
    sessionStorage.setItem("isHost", isHost);
    window.location.href = `/view/room.html?id=${roomId}`;
});

socket.on("room_joined", ({ roomId, isHost }) => {
    sessionStorage.setItem("roomId", roomId);
    sessionStorage.setItem("isHost", isHost);
    window.location.href = `/view/room.html?id=${roomId}`;
});

socket.on("error", ({ message }) => {
    //errore quando la persona non riesce ad entrare nella stanza
});

socket.on("connect", () => {
    const roomId = sessionStorage.getItem("roomId");
    if (roomId) socket.emit("rejoin_room");
});