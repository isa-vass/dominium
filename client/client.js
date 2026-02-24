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
const selectionCard = document.getElementById("selection-card-rooms"); //contenitore rettangolare che mostra stanze
const selectionCardJoin = document.getElementById("selection-card-join"); //contenitore rettangolare per inserimento code
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
    // Nascondi il bottone CREATE
    buttonGroup.style.display = "none";

    // Mostra la card di join
    selectionCardJoin.innerHTML = `
        <h2>JOIN</h2>
        <label class="join-label">INSERT THE ROOM CODE</label>
        <input type="text" class="join-input" id="room-code-input" />
        <button class="btn btn-primary" id="btn-join">JOIN</button>
    `;

    document.getElementById("btn-join").addEventListener("click", () => {
        const code = document.getElementById("room-code-input").value.trim();
        if (code) socket.emit("join_room", code);
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