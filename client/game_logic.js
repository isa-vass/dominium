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

let myRoll = null; // Variabile per memorizzare il roll del giocatore

console.log("game_logic.js loaded, btnRoll:", btnRoll, "socket:", socket);

function showModal() {
    overlay.style.display = "flex";
    pageContent.classList.add("blur");
}

function hideModal() {
    overlay.style.display = "none";
    pageContent.classList.remove("blur");
}

// Mostra il modal all'avvio del gioco
showModal();

// Imposta l'info panel
const playerName = sessionStorage.getItem("playerName") || "Giocatore";
console.log("playerName from storage:", playerName);
document.getElementById("pp-name").textContent = playerName;

const playerContinent = sessionStorage.getItem("playerContinent");
document.getElementById("pp-continent").textContent = playerContinent;


// Rejoin room se necessario
const roomIdFromUrl = new URLSearchParams(window.location.search).get("id");
const roomId = roomIdFromUrl || sessionStorage.getItem("roomId");
if (roomId && socket.connected) {
    socket.emit("rejoin_room", { roomId });
} else if (roomId) {
    socket.on("connect", () => {
        socket.emit("rejoin_room", { roomId });
    });
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
    // Aggiorna il nome del player nel panel
    const myEntry = turnOrder.find(p => p.socketId === socket.id);
    if (myEntry) {
        document.getElementById("pp-name").textContent = myEntry.name;
        document.getElementById("pp-continent").textContent = myEntry.continent;
        // Salva il continente in sessionStorage per uso successivo
        sessionStorage.setItem("playerContinent", myEntry.continent);
        sessionStorage.setItem("playerName", myEntry.name);
    }

    modalTitle.textContent = "Ordine Turni Stabilito!";
    modalDesc.textContent = "La partita sta per iniziare...";
    diceRollsList.innerHTML = "";
    btnRoll.style.display = "none";
    waitingMsg.style.display = "none";

    turnOrder.forEach((player, index) => {
        const row = document.createElement("div");
        row.classList.add("dice-roll-row", "final");
        const medals = ["🥇", "🥈", "🥉"];
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

function startGame(turnOrder) {
    console.log("Gioco iniziato, ordine turni:", turnOrder);
    const roomId = getRoomId();
    // Naviga a game_home.html dove inizierà il gioco effettivo
    window.location.href = "/view/game_home.html?id=" + roomId;
}

function getMyRoll() {
    return myRoll;
}

function troopAssignment(playerTroops) {
    const roll = getMyRoll();
    if (roll) {
        const totalTroops = playerTroops + roll;
        console.log(`Truppe assegnate: ${totalTroops} (base: ${playerTroops}, roll: ${roll})`);
        // Qui puoi aggiungere la logica per distribuire le truppe
    } else {
        console.warn("Roll non disponibile per assegnazione truppe");
    }
}

// --- BATTLE LOGIC ---
socket.on("show_action_box", () => {
    showModal();
});

socket.on("game_state", ({ provinces: serverProvinces, turnOrder, currentTurnIndex, playerNames, playerContinents }) => {
    // Aggiorna le province con i dati dal server
    Object.keys(serverProvinces).forEach(id => {
        if (provinces[id]) {
            provinces[id] = { ...provinces[id], ...serverProvinces[id] };
        }
    });
    // Aggiorna l'info panel con il continente del player
    const myContinent = playerContinents[socket.id];
    if (myContinent) {
        document.getElementById("pp-continent").textContent = myContinent;
        sessionStorage.setItem("playerContinent", myContinent);
    }
    console.log("Stato gioco ricevuto:", provinces);
});

socket.on("turn_advanced", ({ currentTurnIndex, provinces: updatedProvinces }) => {
    // Aggiorna le province
    Object.keys(updatedProvinces).forEach(id => {
        if (provinces[id]) {
            provinces[id] = { ...provinces[id], ...updatedProvinces[id] };
        }
    });
    console.log("Turno avanzato, province aggiornate");
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