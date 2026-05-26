const socket = io();

const continentMap = {
    'agartha': 'Divine Empire of Agartha',
    'garganta': 'Duchy of Garganta',
    'fimia': 'Kingdom of Fimia',
    'arstotzka': 'Union of Arstotzka'
};

// --- LEGGI SESSIONE PHP E IMPOSTA IL NOME SU NODE.JS ---
async function initSessionFromPHP() {
    try {
        const res = await fetch("/auth/session");
        const data = await res.json();

        if (!data.loggedIn) {
            window.location.href = "/login.html";
            return;
        }

        // Rimuovi questa riga: non impostare più il nome automaticamente dall'email
        // socket.emit("set_name", data.email.split("@")[0]);

        // Salva solo i dati di sessione per altri usi (es. ID utente)
        sessionStorage.setItem("idU", data.idU);
        sessionStorage.setItem("email", data.email);

    } catch (err) {
        console.error("Errore sessione:", err);
    }
}

// --- HOME PAGE ---
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

// --- ACTION PAGE ---
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

socket.on("session_expired", () => {
    alert("Sessione scaduta: account acceduto da un altro dispositivo.");
    window.location.href = "/login.html";
});

socket.on("room_created", ({ roomId, roomCode }) => {
    sessionStorage.setItem("roomId", roomId);
    sessionStorage.setItem("roomCode", roomCode);
    window.location.href = `/view/room.html?id=${roomId}`;
});

socket.on("room_joined", ({ roomId, roomCode }) => {
    sessionStorage.setItem("roomId", roomId);
    sessionStorage.setItem("roomCode", roomCode);
    window.location.href = `/view/room.html?id=${roomId}`;
});

function showGlobalError(message) {
    let el = document.getElementById("global-error");
    if (!el) {
        el = document.createElement("div");
        el.id = "global-error";
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(showGlobalError._timer);
    showGlobalError._timer = setTimeout(() => {
        el.style.display = "none";
    }, 3000);
}

socket.on("error", ({ message }) => {
    showGlobalError(message);
});

socket.on("connect", () => {
    initSessionFromPHP();
    const roomId = sessionStorage.getItem("roomId");
    if (roomId) socket.emit("rejoin_room", { roomId });
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

// --- ROOM PAGE ---
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
    if (roomCode) {
        document.getElementById("display-room-code").textContent = roomCode;
        document.getElementById("code-badge").removeAttribute("hidden");
        document.getElementById("display-room-code-2").textContent = roomCode;
        document.getElementById("code-box").removeAttribute("hidden");
    }

    // --- CONTINENTS ---
    document.querySelectorAll(".continent-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.classList.contains("locked")) return;
            document.querySelectorAll(".continent-btn").forEach(b => b.classList.remove("selected"));
            btn.classList.add("selected");
            const continent = continentMap[btn.dataset.continent];
            sessionStorage.setItem("playerContinent", continent);
            socket.emit("select_continent", { roomId, continent });
        });
    });

    // --- READY ---
    let isReady = false;
    const btnReady = document.getElementById("btn-ready");
    btnReady.addEventListener("click", () => {
        if (!hasSelectedContinent) {
            alert("Seleziona un continente prima di metterti pronto");
            return;
        }
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

    // --- LEAVE ROOM ---
    document.getElementById("btn-leave").addEventListener("click", () => {
        socket.emit("leave_room", { roomId });
        fetch("/leave-room", { method: "POST" }).finally(() => {
            sessionStorage.clear();
            window.location.href = "/view/action.html";
        });
    });
}

// La funzione confirmName non serve più, il nome viene preso dalla sessione PHP.
// Tuttavia la manteniamo come fallback nel caso room.html la chiami ancora,
// così non crasha. Puoi rimuoverla quando aggiorni room.html.
function confirmName(roomId) {
    initRoom(roomId);
}

function renderPlayers(players) {
    const list = document.getElementById("player-list");
    if (!list) return;
    list.innerHTML = "";
    players.forEach(p => {
        const el = document.createElement("div");
        el.classList.add("player-item");
        if (p.ready) el.classList.add("ready");
        el.innerHTML = `
            <span class="player-name">${p.name}</span>
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
function startCountdown(seconds, type = "normal") {
    const bar = document.getElementById("countdown-bar");
    console.log("1. bar element:", bar);
    if (!bar) return;
    const number = document.getElementById("countdown-number");
    const fill = document.getElementById("countdown-fill");
    const text = document.getElementById("countdown-text");
    console.log("2. number:", number, "fill:", fill, "text:", text);

    const total = Number(seconds);
    console.log("3. total:", total);
    if (!Number.isFinite(total) || total <= 0) return;

    clearInterval(countdownInterval);
    countdownInterval = null;

    bar.classList.add("visible");
    bar.style.display = "flex";
    console.log("4. bar display after set:", bar.style.display, "classes:", bar.className);

    text.textContent = type === "game" ? "Game starting in" : "The game starts in";

    let remaining = Math.ceil(total);

    function tick() {
        console.log("TICK remaining:", remaining);
        number.textContent = remaining;
        fill.style.width = (remaining / total * 100) + "%";
    }

    tick();
    console.log("5. first tick done, number.textContent:", number.textContent);

    countdownInterval = setInterval(() => {
        remaining--;
        console.log("INTERVAL remaining:", remaining);
        if (remaining <= 0) {
            remaining = 0;
            tick();
            clearInterval(countdownInterval);
            countdownInterval = null;
            return;
        }
        tick();
    }, 1000);

    console.log("6. setInterval set, countdownInterval:", countdownInterval);
}

function stopCountdown() {
    const bar = document.getElementById("countdown-bar");
    if (!bar) return;
    clearInterval(countdownInterval);
    countdownInterval = null;
    bar.classList.remove("visible");
    bar.style.display = "none";
}

let gameTimerInterval = null;
function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function startGameTimer(endTime, serverTime) {
    const display = document.getElementById("game-timer-display");
    if (!display) return;

    display.style.display = "block";

    clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
        if (remaining <= 0) {
            clearInterval(gameTimerInterval);
            display.textContent = formatTimer(0);
            return;
        }
        display.textContent = formatTimer(remaining);
    }, 1000);

    // Aggiorna immediatamente
    const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    display.textContent = formatTimer(remaining);
}

function stopGameTimer() {
    const display = document.getElementById("game-timer-display");
    if (!display) return;
    clearInterval(gameTimerInterval);
    display.style.display = "none";
}

let hasSelectedContinent = false;
function updateContinents(selectedContinents, currentPlayerName) {
    document.querySelectorAll(".continent-btn").forEach(btn => {
        const continent = continentMap[btn.dataset.continent];
        const selectedBy = selectedContinents[continent];

        btn.classList.remove("selected", "locked");

        if (selectedBy === currentPlayerName) {
            btn.classList.add("selected");
        } else if (selectedBy) {
            btn.classList.add("locked");
        }
    });
    hasSelectedContinent = Object.values(selectedContinents).includes(currentPlayerName);
}

// --- SOCKET EVENTS per room page ---
socket.on("players_updated", ({ players }) => {
    if (typeof renderPlayers === "function") renderPlayers(players);
});

// Removed duplicate listener: `room.html` already registers its own handler

socket.on("game_timer_start", ({ endTime, serverTime }) => {
    if (typeof startGameTimer === "function") startGameTimer(endTime, serverTime);
});

socket.on("countdown_stop", () => {
    if (typeof stopCountdown === "function") stopCountdown();
});

socket.on("continents_updated", ({ selectedContinents, currentPlayerName }) => {
    if (typeof updateContinents === "function") updateContinents(selectedContinents, currentPlayerName);
});

socket.on("game_countdown_start", ({ seconds }) => {
    if (typeof startCountdown === "function") startCountdown(seconds, "game");
});