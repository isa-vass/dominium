// ── LOGICA PANEL INIZIALE PER ORDINE DEI TURNI ──
const overlay = document.getElementById("overlay");
const pageContent = document.getElementById("page-content");
const btnRoll = document.getElementById("btn-roll-dice");
const waitingMsg = document.getElementById("waiting-msg");
const diceResultDisplay = document.getElementById("dice-result-display");
const myRollValue = document.getElementById("my-roll-value");
const diceRollsList = document.getElementById("dice-rolls-list");
const modalTitle = document.getElementById("modal-title");
const modalDesc = document.getElementById("modal-desc");
const placementBanner = document.getElementById("placement-banner");
const troopsToPlaceEl = document.getElementById("troops-to-place");
const tooltip = document.getElementById('tooltip');
let troopsToPlace = 0;
let placementPhase = false;
let pendingTroops = null;

let myRoll = null; // Variabile per memorizzare il roll del giocatore

let turnCounter = 1;

const players = new Map();

const continentColors = {
    'Divine Empire of Agartha': '#a7c957',
    'Duchy of Garganta': '#cbeef3',
    'Kingdom of Fimia': '#ef233c',
    'Union of Arstotzka': '#ffb3c6'
};

// Tu stesso, subito
players.set(socket.id, {
    name: sessionStorage.getItem("playerName") || "Giocatore",
    continent: sessionStorage.getItem("playerContinent") || "Nessun Continente",
    troops: 0,
    roll: null,
    ready: false
});

let provinces = {};

socket.on("provinces_data", (data) => {
    provinces = data;
    // ora puoi inizializzare i listener delle province
    initMap();
});


// Gli altri, quando arriva l'evento dal server
socket.on("players_updated", ({ players: serverPlayers }) => {
    serverPlayers.forEach(p => {
        players.set(p.id, {
            name: p.name,
            continent: p.continent || null,
            troops: p.troops || 0,
            roll: null,
            ready: p.ready
        });
    });
});

console.log("game_logic.js loaded, btnRoll:", btnRoll, "socket:", socket);

function showModal() {
    overlay.style.display = "flex";
    pageContent.classList.add("blur");
}

function hideModal() {
    overlay.style.display = "none";
    pageContent.classList.remove("blur");
}

// Flag per evitare il loop infinito della roll UI
let gameHasStarted = false;

// Imposta l'info panel
const playerName = sessionStorage.getItem("playerName") || "Giocatore";
console.log("playerName from storage:", playerName);
document.getElementById("pp-name").textContent = playerName;

const playerContinent = sessionStorage.getItem("playerContinent");
document.getElementById("pp-continent").textContent = playerContinent;

applyPlayerColor(playerContinent);

// Controlla se il gioco è già iniziato (persiste tra reload)
const gameAlreadyStarted = sessionStorage.getItem("gameStarted") === "true";
if (gameAlreadyStarted) {
    console.log("[game_logic] Gioco già iniziato, skipping dice modal.");
    gameHasStarted = true;
    hideModal();
}


// Rejoin room se necessario
const roomIdFromUrl = new URLSearchParams(window.location.search).get("id");
const roomId = roomIdFromUrl || sessionStorage.getItem("roomId");

function applyPlayerColor(continent) {
    const color = continentColors[continent] || '#ffffff';
    document.getElementById("pp-name").style.color = color;
    document.getElementById("pp-continent").style.color = color;
}

// Controlla lo stato dei turni al caricamento della pagina
function checkGameState() {
    if (roomId && socket.connected) {
        socket.emit("check_turn_order_status", { roomId });
    }
}

if (roomId && socket.connected) {
    checkGameState();
    socket.emit("rejoin_room", { roomId });
} else if (roomId) {
    socket.on("connect", () => {
        checkGameState();
        socket.emit("rejoin_room", { roomId });
    });
}

// Listener per lo stato dei turni
socket.on("turn_order_status", ({ isDecided, turnOrder }) => {
    console.log("[turn_order_status] isDecided:", isDecided, "turnOrder:", turnOrder);
    if (isDecided && !gameHasStarted) {
        gameHasStarted = true;
        hideModal();
        console.log("[turn_order_status] Turn order già deciso, nascondo il pannello del dado.");
    }
});

// Mostra il modal solo se il gioco non è iniziato
if (!gameHasStarted) {
    showModal();
}

function getRoomId() {
    const rid = sessionStorage.getItem("roomId")
        || localStorage.getItem("roomId")
        || new URLSearchParams(window.location.search).get("roomId")
        || new URLSearchParams(window.location.search).get("id");
    console.log("[getRoomId]", rid);
    return rid;
}

btnRoll.addEventListener("click", () => {
    const rId = getRoomId();
    console.log("[btnRoll] roomId:", rId, "socket:", socket.id, "connected:", socket.connected);

    if (!rId) {
        console.warn("[btnRoll] roomId mancante");
        modalDesc.textContent = "Errore: manca roomId, torna in lobby.";
        btnRoll.disabled = true;
        return;
    }

    if (!socket.connected) {
        console.warn("[btnRoll] socket non connesso");
        modalDesc.textContent = "Errore: connessione persa, ricarica la pagina.";
        return;
    }

    sessionStorage.setItem("roomId", rId);

    btnRoll.disabled = true;
    btnRoll.textContent = "Dado tirato!";
    console.log("[btnRoll] emitting roll_for_turn_order");
    socket.emit("roll_for_turn_order", { roomId: rId });
});

socket.on("error", ({ message }) => {
    console.error("Errore socket:", message);
    modalDesc.textContent = message;
});

// Aggiorna la lista quando un giocatore tira
socket.on("player_rolled", ({ socketId, name, roll }) => {
    let row = document.getElementById(`roll-${socketId}`);
    if (!row) {
        row = document.createElement("div");
        row.id = `roll-${socketId}`;
        row.classList.add("dice-roll-row");
        diceRollsList.appendChild(row);
    }

    const isMe = socketId === socket.id;
    row.innerHTML = `
        <span class="dice-roll-name">${name}${isMe ? " (tu)" : ""}</span>
        <div class="dice-roll-badge">
            <div class="dice-face">${roll}</div>
        </div>
    `;

    // Riordina la lista in ordine decrescente in tempo reale
    const rows = Array.from(diceRollsList.querySelectorAll(".dice-roll-row"));
    rows.sort((a, b) => {
        const rollA = parseInt(a.querySelector(".dice-face")?.textContent || "0");
        const rollB = parseInt(b.querySelector(".dice-face")?.textContent || "0");
        return rollB - rollA;
    });
    diceRollsList.innerHTML = "";
    rows.forEach(r => diceRollsList.appendChild(r));

    if (isMe) {
        myRoll = roll; // Memorizza il roll per riutilizzo
        diceResultDisplay.style.display = "block";
        myRollValue.textContent = roll;
        waitingMsg.style.display = "block";
    }
});

// Pareggio
socket.on("turn_order_tie", ({ tiedPlayerIds, tiedNames }) => {
    const isTied = tiedPlayerIds.includes(socket.id);

    modalTitle.textContent = "Pareggio!";
    modalDesc.textContent = `Pareggio tra: ${tiedNames.join(", ")}. Devono ritirare il dado.`;
    diceRollsList.innerHTML = "";
    diceResultDisplay.style.display = "none";
    waitingMsg.style.display = "none";

    if (isTied) {
        btnRoll.disabled = false;
        btnRoll.textContent = "Ritira il Dado";
        btnRoll.style.display = "block";
    } else {
        btnRoll.style.display = "none";
        waitingMsg.style.display = "block";
        waitingMsg.textContent = "In attesa dell'esito del pareggio...";
    }
});

// Ordine finale deciso
socket.on("turn_order_decided", ({ turnOrder, playerContinents }) => {

    console.log("[turn_order_decided] playerContinents full:", playerContinents);
    const myContinent = playerContinents[socket.id];
    console.log("[turn_order_decided] my continent:", myContinent);

    if (!myContinent) {
        console.warn("[turn_order_decided] continente mancante per socket:", socket.id);
    }
    // (opzionale) fallback:
    const continentToShow = myContinent || "nessun continente";
    document.getElementById("pp-continent").textContent = continentToShow;

    const myEntry = turnOrder.find(p => p.socketId === socket.id);
    console.log("myEntry:", myEntry);
    if (myEntry) {
        document.getElementById("pp-name").textContent = myEntry.name;
        document.getElementById("pp-continent").textContent = myEntry.continent;
        document.getElementById("pp-troops").textContent = myEntry.troops;

        applyPlayerColor(myEntry.continent);

        // Salva il continente in sessionStorage per uso successivo
        sessionStorage.setItem("playerContinent", myEntry.continent);
        sessionStorage.setItem("playerName", myEntry.name);
        sessionStorage.setItem("playerTroops", myEntry.troops);
    }

    modalTitle.textContent = "Ordine Turni Stabilito!";
    modalDesc.textContent = "La partita sta per iniziare...";
    diceRollsList.innerHTML = "";
    btnRoll.style.display = "none";
    waitingMsg.style.display = "none";

    turnOrder.forEach((player, index) => {
        const row = document.createElement("div");
        row.classList.add("dice-roll-row", "final");
        const medals = ["🥇", "🥈", "🥉"]; //da levare / cambiare 
        const medal = medals[index] || `${index + 1}.`;
        const isMe = player.socketId === socket.id;
        row.innerHTML = `
            <span class="dice-roll-name">${medal} ${player.name}${isMe ? " (tu)" : ""}</span>
        `;
        diceRollsList.appendChild(row);
    });

    let sec = 5;
    const countdownEl = document.getElementById("modal-countdown");
    const countdownNum = document.getElementById("modal-countdown-num");
    const countdownFill = document.getElementById("modal-countdown-fill");

    if (countdownEl) {
        countdownEl.style.display = "flex";
        countdownNum.textContent = sec;
        countdownFill.style.width = "100%";

        const iv = setInterval(() => {
            sec--;
            countdownNum.textContent = sec;
            countdownFill.style.width = (sec / 5 * 100) + "%";
            if (sec <= 0) {
                clearInterval(iv);
                hideModal();
                startGame(turnOrder);
            }
        }, 1000);
    } else {
        setTimeout(() => {
            hideModal();
            startGame(turnOrder);
        }, 5000);
    }
});

let currentPlayer = null;

socket.on("turn", ({ currentPlayerId, turnOrder }) => {
    currentPlayer = currentPlayerId;
    const isMyTurn = currentPlayerId === socket.id;

    // Aggiorna UI
    document.querySelectorAll(".player-item").forEach(item => {
        const nameEl = item.querySelector(".player-name");
        if (!nameEl) return;
        const playerName = nameEl.textContent.replace(" (tu)", "");
        const isActive = playerName === turnOrder.find(p => p.socketId === currentPlayerId)?.name;
        item.classList.toggle("active-turn", isActive);
    });

    // Abilita/disabilita controlli in base al turno
    if (isMyTurn) {
        console.log("È il tuo turno!");
        enableGameControls();
    } else {
        console.log("Turno di:", turnOrder.find(p => p.socketId === currentPlayerId)?.name);
        disableGameControls();
    }
});

// Quando il giocatore finisce il suo turno
document.getElementById("btn-end-turn").addEventListener("click", () => {
    socket.emit("end_turn", { roomId });
});

function startGame(turnOrder) {
    console.log("Gioco iniziato, ordine turni:", turnOrder);
    gameHasStarted = true;
    sessionStorage.setItem("gameStarted", "true");
    hideModal();

    // Applica placement_start bufferizzato
    if (pendingTroops !== null) {
        console.log("[startGame] applico pendingTroops:", pendingTroops);
        applyPlacementStart(pendingTroops);
        pendingTroops = null;
    }
}


// --- BATTLE LOGIC ---
socket.on("show_action_box", () => {
    showModal();
});

function attack(attackerTroops, defenderTroops) {
    socket.emit("win_chance", { attackerTroops, defenderTroops });
}

socket.on("battle_result", ({ winner }) => {
    if (winner === "attacker") {
        console.log("L'attaccante ha vinto!");
    } else {
        console.log("Il difensore ha resistito!");
    }
});


function initMap() {
    Object.keys(provinces).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        // Tooltip
        el.addEventListener('mouseenter', () => {
            const d = provinces[id];
            const col = continentColors[d.continent] || '#fff';
            tooltip.innerHTML = `
                <div class="t-name">${d.name}</div>
                <div class="t-state" style="color:${col}">${d.continent}</div>
                <div class="t-row"><span class="t-label">Owner</span><span class="t-val">${d.owner || '—'}</span></div>
                <div class="t-row"><span class="t-label">Troops</span><span class="t-val">${d.troops || 0}</span></div>
            `;
            tooltip.style.display = 'block';
        });

        el.addEventListener('mousemove', e => {
            tooltip.style.left = (e.clientX + 18) + 'px';
            tooltip.style.top = (e.clientY + 18) + 'px';
            const r = tooltip.getBoundingClientRect();
            if (r.right > window.innerWidth) tooltip.style.left = (e.clientX - r.width - 10) + 'px';
            if (r.bottom > window.innerHeight) tooltip.style.top = (e.clientY - r.height - 10) + 'px';
        });

        el.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });

        // Click
        el.addEventListener('click', () => handleProvinceClick(id));
    });
}

socket.on("placement_start", ({ troops }) => {
    console.log("[placement_start] ricevuto, troops:", troops, "overlay display:", overlay.style.display);
    // Se il modal è ancora aperto (countdown in corso), bufferizza
    if (overlay.style.display !== "none") {
        console.log("[placement_start] modal ancora aperto, bufferizzato");
        pendingTroops = troops;
        return;
    }
    applyPlacementStart(troops);
});

function applyPlacementStart(troops) {
    console.log("[applyPlacementStart] troops:", troops);
    placementPhase = true;
    troopsToPlace = troops;
    troopsToPlaceEl.textContent = troopsToPlace;
    placementBanner.style.display = "block";
}

function handleProvinceClick(provinceId) {
    if (!placementPhase) return;
    const province = provinces[provinceId];
    const myContinent = sessionStorage.getItem("playerContinent");
    if (province.continent !== myContinent) return;
    if (troopsToPlace <= 0) return;
    socket.emit("place_troop", { provinceId, roomId: getRoomId() });
}

socket.on("province_updated", ({ provinceId, troops, ownerName }) => {
    provinces[provinceId].troops = troops;
    provinces[provinceId].owner = ownerName;

    updateTroopMarker(provinceId, troops, ownerName);
});

socket.on("troops_remaining", ({ troopsToPlaceLeft }) => {
    troopsToPlace = troopsToPlaceLeft;
    troopsToPlaceEl.textContent = troopsToPlace;
    if (troopsToPlace <= 0) {
        placementBanner.style.display = "none";
    }
});

function updateTroopMarker(provinceId, troops, ownerName) {
    const svgEl = document.querySelector("svg");
    const provinceEl = document.getElementById(provinceId);
    if (!provinceEl || !svgEl) return;

    // Calcola il centro approssimativo della provincia dal bounding box
    const bbox = provinceEl.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const markerId = `troop-marker-${provinceId}`;
    let marker = document.getElementById(markerId);

    if (!marker) {
        // Crea il gruppo marker
        marker = document.createElementNS("http://www.w3.org/2000/svg", "g");
        marker.id = markerId;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "18");
        circle.setAttribute("fill", "rgba(10,10,10,0.75)");
        circle.setAttribute("stroke", "#ff4444");
        circle.setAttribute("stroke-width", "2");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("fill", "#ffffff");
        text.setAttribute("font-size", "16");
        text.setAttribute("font-family", "Cinzel, Georgia, serif");
        text.setAttribute("font-weight", "bold");
        text.setAttribute("pointer-events", "none");

        marker.appendChild(circle);
        marker.appendChild(text);
        svgEl.appendChild(marker);
    }

    marker.setAttribute("transform", `translate(${cx}, ${cy})`);
    marker.querySelector("text").textContent = troops;
    marker.style.display = troops > 0 ? "block" : "none";
}

function showPlacementError(message) {
    const el = document.getElementById("placement-error");
    el.textContent = message;
    el.style.display = "block";
    clearTimeout(showPlacementError._timer);
    showPlacementError._timer = setTimeout(() => {
        el.style.display = "none";
    }, 3000);
}


socket.on("error", ({ message }) => {
    if (placementPhase) {
        showPlacementError(message);
    } else {
        modalDesc.textContent = message;
    }
});

socket.on("placement_complete", () => {
    placementPhase = false;
});

socket.on("troop_roll_start", () => {
    modalTitle.textContent = "Tira per le Truppe!";
    modalDesc.textContent = "Tira il dado per ricevere nuove truppe!";
    diceRollsList.innerHTML = "";
    diceResultDisplay.style.display = "none";
    waitingMsg.style.display = "none";
    btnRoll.disabled = false;
    btnRoll.textContent = "Tira il Dado";
    btnRoll.style.display = "block";
    showModal();
});