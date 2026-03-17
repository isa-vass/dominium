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
    alert(message);
});

socket.on("connect", () => {
    const roomId = sessionStorage.getItem("roomId");
    const isHost = sessionStorage.getItem("isHost") === "true";
    if (roomId) socket.emit("rejoin_room", { roomId, isHost });
});

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
    });
}

// ROOM PAGE - Funzioni di utility
function confirmName(roomId) {
    const nameInput = document.getElementById("name-input");
    const val = nameInput.value.trim();
    if (!val) return;

    socket.emit("set_name", val);

    document.getElementById("name-container").style.display = "none";
    document.getElementById("room-container").style.display = "block";

    initRoom(roomId);
}

function initRoom(roomId) {
    history.pushState(null, null, window.location.href);
    window.addEventListener("popstate", () => {
        history.pushState(null, null, window.location.href);
    });

    window.addEventListener("beforeunload", () => {
        socket.emit("leave_room", { roomId });
        sessionStorage.clear();
    });

    if (roomId) document.getElementById("display-room-id").textContent = roomId;

    const roomCode = sessionStorage.getItem("roomCode");
    const isHost = sessionStorage.getItem("isHost") === "true";

    if (roomCode && isHost) {
        document.getElementById("display-room-code").textContent = roomCode;
        document.getElementById("code-badge").removeAttribute("hidden");
        document.getElementById("display-room-code-2").textContent = roomCode;
        document.getElementById("code-box").removeAttribute("hidden");
    }

    // Continenti
    document.querySelectorAll(".continent-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".continent-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            socket.emit("select_continent", { roomId, continent: btn.dataset.continent });
        });
    });

    // Pronto
    let isReady = false;
    const btnReady = document.getElementById("btn-ready");
    btnReady.addEventListener("click", () => {
        isReady = !isReady;
        if (isReady) {
            btnReady.textContent = "NOT READY";
            btnReady.classList.replace("btn-primary", "btn-ready");
        } else {
            btnReady.textContent = "READY";
            btnReady.classList.replace("btn-ready", "btn-primary");
        }
        socket.emit("player_ready", { roomId, ready: isReady });
    });

    // Lascia stanza
    document.getElementById("btn-leave").addEventListener("click", () => {
        socket.emit("leave_room", { roomId });
        fetch("/leave-room", { method: "POST" }).finally(() => {
            sessionStorage.clear();
            window.location.href = "/view/action.html";
        });
    });
}

function renderPlayers(players) {
    const list = document.getElementById("player-list");
    list.innerHTML = "";
    players.forEach(p => {
        const el = document.createElement("div");
        el.classList.add("player-item");
        if (p.ready) el.classList.add("ready");
        el.innerHTML = `
            <span class="player-name">${p.name}${p.isHost ? " 👑" : ""}</span>
            <span class="player-status ${p.ready ? "status-ready" : "status-waiting"}">
                ${p.ready ? "Ready" : "Waiting"}
            </span>`;
        list.appendChild(el);
    });
    for (let i = players.length; i < 4; i++) {
        const slot = document.createElement("div");
        slot.classList.add("player-slot-empty");
        slot.textContent = i === 0 ? "Waiting..." : "Empty slot";
        list.appendChild(slot);
    }
}

let countdownInterval = null;
function startCountdown(seconds) {
    const bar = document.getElementById("countdown-bar");
    const number = document.getElementById("countdown-number");
    const fill = document.getElementById("countdown-fill");
    bar.classList.add("visible");
    let remaining = seconds;
    number.textContent = remaining;
    fill.style.width = "100%";
    countdownInterval = setInterval(() => {
        remaining--;
        number.textContent = remaining;
        fill.style.width = (remaining / seconds * 100) + "%";
        if (remaining <= 0) clearInterval(countdownInterval);
    }, 1000);
}

function stopCountdown() {
    clearInterval(countdownInterval);
    document.getElementById("countdown-bar").classList.remove("visible");
}