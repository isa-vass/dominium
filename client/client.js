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
const selectionCard = document.getElementById("selection-card");
const btnCreate = document.getElementById("btn-create");

function renderRooms(rooms) {
    if (!selectionCard) return;

    selectionCard.innerHTML = "";

    if (rooms.length === 0) {
        selectionCard.innerHTML = "<p class='no-rooms'>Nessuna stanza disponibile</p>";
        return;
    }

    rooms.forEach((room) => {
        const roomEl = document.createElement("div");
        roomEl.classList.add("room-item");
        roomEl.innerHTML = `
            <span>Stanza <strong>${room.id}</strong></span>
            <button class="btn btn-secondary btn-join" data-id="${room.id}">JOIN</button>
        `;
        selectionCard.appendChild(roomEl);
    });

    // Aggiunge listener ai bottoni JOIN appena creati
    document.querySelectorAll(".btn-join").forEach((btn) => {
        btn.addEventListener("click", () => {
            const roomId = btn.dataset.id;
            socket.emit("join_room", roomId);
        });
    });
}

if (selectionCard) {
    // Richiedi la lista stanze al caricamento della pagina
    socket.emit("get_rooms");

    // Quando il server manda la lista aggiornata
    socket.on("rooms_list", (rooms) => {
        renderRooms(rooms);
    });

    // Quando qualcosa cambia (nuova stanza, qualcuno entra/esce)
    socket.on("rooms_updated", () => {
        socket.emit("get_rooms");
    });
}

if (btnCreate) {
    btnCreate.addEventListener("click", () => {
        socket.emit("create_room");
    });
}

socket.on("room_created", (data) => {
    console.log("Stanza creata con ID:", data.roomId);
});

socket.on("room_joined", (data) => {
    console.log("Entrato nella stanza:", data.roomId);
    window.location.href = "/view/prova.html";
});