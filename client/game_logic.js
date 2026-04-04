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

let isTroopRoll = false;

let battleState = {
    active: false,
    role: null, // "attacker" | "defender" | "spectator"
    maxDice: 0,
    selectedDice: [],
};

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

// Controlla lo stato dei turni al caricamento della pagina

if (roomId && socket.connected) {
    checkGameState();
    socket.emit("rejoin_room", { roomId });
} else if (roomId) {
    socket.on("connect", () => {
        checkGameState();
        socket.emit("rejoin_room", { roomId });
    });
}

// Il server ci chiede di tirare i dadi per la battaglia
socket.on("battle_roll_request", ({
    role, maxDice, attackerName, defenderName,
    fromProvinceId, toProvinceId, attackerTroops, defenderTroops
}) => {
    battleState = { active: true, role, maxDice, selectedDice: [] };
    showBattleModal({
        role, maxDice, attackerName, defenderName,
        attackerTroops, defenderTroops
    });
});

// Notifica che un giocatore ha tirato (senza rivelare i dadi)
socket.on("battle_player_rolled", ({ role, name }) => {
    const el = document.getElementById(`battle-rolled-${role}`);
    if (el) {
        el.textContent = `✔ ${name} ha tirato`;
        el.style.color = "#a7c957";
    }
});

// Spettatori: mostra che una battaglia è iniziata
socket.on("battle_started", ({ attackerName, defenderName, fromProvinceId, toProvinceId }) => {
    if (battleState.active) return; // già nel modal
    const banner = document.getElementById("turn-banner");
    banner.textContent = `⚔ ${attackerName.toUpperCase()} attacca ${defenderName.toUpperCase()}!`;
    banner.style.display = "block";
    banner.style.opacity = "1";
    setTimeout(() => {
        banner.style.opacity = "0";
        setTimeout(() => { banner.style.display = "none"; }, 500);
    }, 3000);
});

// Risultato con slider se conquista
socket.on("attack_result", ({
    winner, attackerName, defenderName,
    attackerDices, defenderDices,
    attackerLosses, defenderLosses,
    provinceConquered, maxMovableTroops, minMovableTroops,
    fromProvinceId, toProvinceId, autoMoved
}) => {
    battleState.active = false;
    hideBattleModal();
    showAttackResult({
        winner, attackerName, defenderName,
        attackerDices, defenderDices,
        attackerLosses, defenderLosses,
        provinceConquered, maxMovableTroops, minMovableTroops,
        fromProvinceId, toProvinceId, autoMoved
    });
});

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

btnRoll.addEventListener("click", () => {
    const rId = getRoomId();
    if (!rId || !socket.connected) return;

    sessionStorage.setItem("roomId", rId);
    const roll = Math.floor(Math.random() * 6) + 1;
    btnRoll.disabled = true;
    btnRoll.textContent = "Dado tirato!";

    if (isTroopRoll) {
        socket.emit("roll_for_troops", { roomId: rId, roll });
        diceResultDisplay.style.display = "block";
        myRollValue.textContent = roll;

    } else if (btnRoll._isTieRoll) {
        // ── re-roll per il pareggio ──
        btnRoll._isTieRoll = false;
        socket.emit("roll_for_tie", { roomId: rId });
        diceResultDisplay.style.display = "block";
        myRollValue.textContent = roll;
        waitingMsg.style.display = "block";
        waitingMsg.textContent = "In attesa degli altri...";

    } else {
        socket.emit("roll_for_turn_order", { roomId: rId });
    }
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

// Listener per roll truppe
socket.on("player_troop_rolled", ({ socketId, name, roll }) => {
    let row = document.getElementById(`troop-roll-${socketId}`);
    if (!row) {
        row = document.createElement("div");
        row.id = `troop-roll-${socketId}`;
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

    if (isMe) {
        diceResultDisplay.style.display = "block";
        myRollValue.textContent = roll;
        waitingMsg.style.display = "block";
        waitingMsg.textContent = "In attesa degli altri giocatori...";
    }
});

// Ordine finale deciso
socket.on("turn_order_decided", ({ turnOrder, playerContinents }) => {

    window._turnOrderDetails = turnOrder;

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
    resetAttackState();
    currentPlayer = currentPlayerId;
    const isMyTurn = currentPlayerId === socket.id;

    document.querySelectorAll(".player-item").forEach(item => {
        const nameEl = item.querySelector(".player-name");
        if (!nameEl) return;
        const playerName = nameEl.textContent.replace(" (tu)", "");
        const isActive = playerName === turnOrder.find(p => p.socketId === currentPlayerId)?.name;
        item.classList.toggle("active-turn", isActive);
    });

    const btnEnd = document.getElementById("btn-end-turn");
    const banner = document.getElementById("turn-banner");

    if (isMyTurn && !placementPhase) {
        turnMessage(turnCounter, false, true);
        btnEnd.style.display = "block";
        enableGameControls();
    } else {
        // NUOVO: mostra di chi è il turno
        const currentName = turnOrder.find(p => p.socketId === currentPlayerId)?.name || "...";
        banner.textContent = `⚔ TURNO DI ${currentName.toUpperCase()} ⚔`;
        banner.style.display = "block";
        banner.style.opacity = "1";
        setTimeout(() => {
            banner.style.opacity = "0";
            setTimeout(() => { banner.style.display = "none"; }, 500);
        }, 2500);
        btnEnd.style.display = "none";
        disableGameControls();
    }
});

// Quando il giocatore finisce il suo turno
document.getElementById("btn-end-turn").addEventListener("click", () => {
    socket.emit("end_turn", { roomId });
    turnCounter++;
    document.getElementById("btn-end-turn").style.display = "none";
});




socket.on("show_action_box", () => {
    showModal();
});

socket.on("battle_result", ({ winner }) => {
    if (winner === "attacker") {
        console.log("L'attaccante ha vinto!");
    } else {
        console.log("Il difensore ha resistito!");
    }
});

socket.on("placement_start", ({ troops }) => {
    console.log("[placement_start] ricevuto, troops:", troops, "overlay display:", overlay.style.display);
    isTroopRoll = false; // reset
    hideModal(); // Chiudi il modal sempre
    // Nascondi il bottone Fine Turno durante il placement
    document.getElementById("btn-end-turn").style.display = "none";
    applyPlacementStart(troops);
});

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

socket.on("error", ({ message }) => {
    console.error("Errore socket:", message);
    if (placementPhase) {
        showPlacementError(message);
    } else {
        modalDesc.textContent = message;
    }
});

socket.on("placement_complete", () => {
    placementPhase = false;
    placementBanner.style.display = "none";
    const banner = document.getElementById("turn-banner");
    banner.style.opacity = "0";
    setTimeout(() => { banner.style.display = "none"; }, 500);
});

// Aggiorna le truppe totali quando cambiano (solo durante attacchi/battaglia)
socket.on("player_troops_updated", ({ playerName, troopsRemaining }) => {
    const currentName = sessionStorage.getItem("playerName");
    if (playerName === currentName) {
        document.getElementById("pp-troops").textContent = troopsRemaining;
    }
});

socket.on("tie_detected", ({ tiedPlayers, tiedRoll, allRolls }) => {
    const amITied = tiedPlayers.some(p => p.socketId === socket.id);
    const tiedNames = tiedPlayers.map(p => p.name).join(" e ");

    // Aggiorna la lista mostrando tutti i roll precedenti
    diceRollsList.innerHTML = "";
    for (const [socketId, { name, roll }] of Object.entries(allRolls)) {
        const row = document.createElement("div");
        row.classList.add("dice-roll-row");
        const isMe = socketId === socket.id;
        const isTied = tiedPlayers.some(p => p.socketId === socketId);
        row.innerHTML = `
            <span class="dice-roll-name" style="${isTied ? 'color:#ff4444;font-weight:bold;' : 'opacity:0.5;'}">
                ${name}${isMe ? " (tu)" : ""}${isTied ? " ⚔" : ""}
            </span>
            <div class="dice-roll-badge">
                <div class="dice-face">${roll}</div>
            </div>
        `;
        diceRollsList.appendChild(row);
    }

    // Titolo e descrizione
    modalTitle.textContent = `⚔ PAREGGIO! (${tiedRoll})`;
    diceResultDisplay.style.display = "none";
    waitingMsg.style.display = "none";

    if (amITied) {
        modalDesc.textContent = `Pareggio tra ${tiedNames}! Ritira il dado per decidere.`;
        btnRoll.disabled = false;
        btnRoll.textContent = "Ritira il Dado";
        btnRoll.style.display = "block";

        // Cambia temporaneamente il comportamento del bottone
        btnRoll._isTieRoll = true;
    } else {
        modalDesc.textContent = `Pareggio tra ${tiedNames}! In attesa del loro rilancio...`;
        btnRoll.style.display = "none";
        waitingMsg.style.display = "block";
        waitingMsg.textContent = `In attesa del rilancio di ${tiedNames}...`;
    }

    showModal();
});

socket.on("troop_roll_start", () => {
    isTroopRoll = true;
    // Banner flash per tutti
    const banner = document.getElementById("turn-banner");
    banner.textContent = "⚔ NUOVO LANCIO TRUPPE ⚔";
    banner.style.display = "block";
    banner.style.opacity = "1";
    setTimeout(() => {
        banner.style.opacity = "0";
        setTimeout(() => { banner.style.display = "none"; }, 500);
    }, 2000);

    // Modal dado — uguale per tutti, nessun pareggio
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


// --- FUNZIONI DI GIOCO ---
function showBattleModal({ role, maxDice, attackerName, defenderName, attackerTroops, defenderTroops }) {
    const isParticipant = role === "attacker" || role === "defender";
    const roleLabel = role === "attacker" ? "⚔ SEI L'ATTACCANTE" : "🛡 SEI IL DIFENSORE";

    const modal = document.createElement("div");
    modal.id = "battle-modal";
    modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
        z-index: 500; flex-direction: column; gap: 20px;
    `;

    modal.innerHTML = `
        <div style="background:#1a1f2e; border:2px solid #ff4444; border-radius:16px;
                    padding:32px 40px; min-width:340px; text-align:center; color:#fff;">

            <div style="font-size:13px; letter-spacing:2px; color:#ff4444; margin-bottom:8px;">
                ${isParticipant ? roleLabel : "⚔ BATTAGLIA IN CORSO"}
            </div>

            <div style="font-size:20px; font-weight:bold; margin-bottom:4px;">
                ${attackerName} <span style="color:#ff4444;">VS</span> ${defenderName}
            </div>
            <div style="font-size:13px; color:#888; margin-bottom:24px;">
                Truppe: ${attackerTroops} ⚔ — ${defenderTroops} 🛡
            </div>

            ${isParticipant ? `
                <div style="font-size:14px; color:#ccc; margin-bottom:16px;">
                    Tira ${maxDice} dado${maxDice > 1 ? "i" : ""}
                </div>

                <div id="battle-dice-container" style="display:flex; gap:12px; justify-content:center; margin-bottom:20px; flex-wrap:wrap;">
                    ${Array.from({ length: maxDice }).map((_, i) => `
                        <div class="battle-die" data-index="${i}"
                             style="width:56px; height:56px; background:#2a2f3e; border:2px solid #444;
                                    border-radius:10px; display:flex; align-items:center;
                                    justify-content:center; font-size:26px;">
                            ?
                        </div>
                    `).join("")}
                </div>

                <button id="battle-roll-btn"
                    style="background:#c41e3a; color:#fff; border:none; border-radius:8px;
                           padding:12px 32px; font-size:16px; cursor:pointer; margin-bottom:8px;
                           font-family:inherit; width:100%;">
                    Tira i Dadi
                </button>
            ` : `
                <div style="color:#888; font-size:14px;">In attesa dei tiri...</div>
            `}

            <div style="margin-top:16px; display:flex; gap:24px; justify-content:center; font-size:13px;">
                <div id="battle-rolled-attacker" style="color:#555;">⏳ ${attackerName} sta tirando...</div>
                <div id="battle-rolled-defender" style="color:#555;">⏳ ${defenderName} sta tirando...</div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    if (!isParticipant) return;

    const dice = modal.querySelectorAll(".battle-die");
    const rollBtn = modal.querySelector("#battle-roll-btn");

    rollBtn.addEventListener("click", () => {
        // Tira i dadi
        const rolledValues = Array.from({ length: maxDice }, () => Math.floor(Math.random() * 6) + 1);

        // Mostra i valori
        dice.forEach((die, i) => {
            die.textContent = rolledValues[i];
            die.style.borderColor = "#a7c957";
            die.style.background = "#1e2d10";
        });

        rollBtn.disabled = true;
        rollBtn.style.background = "#444";
        rollBtn.textContent = "Dadi tirati!";

        // Invia automaticamente tutti i dadi tirati
        socket.emit("submit_battle_rolls", {
            roomId: getRoomId(),
            rolls: rolledValues
        });
    });
}

function hideBattleModal() {
    const modal = document.getElementById("battle-modal");
    if (modal) modal.remove();
}

function showAttackResult({
    winner, attackerName, defenderName,
    attackerDices, defenderDices,
    attackerLosses, defenderLosses,
    provinceConquered, maxMovableTroops, minMovableTroops,
    fromProvinceId, toProvinceId, autoMoved = false
}) {
    const myName = sessionStorage.getItem("playerName");
    const isAttacker = myName === attackerName;

    const result = document.createElement("div");
    result.id = "attack-result-modal";
    result.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.80);
        display: flex; align-items: center; justify-content: center;
        z-index: 500;
    `;

    const winnerColor = winner === "attacker" ? "#a7c957" : "#4488ff";
    const winnerText = provinceConquered
        ? `🎯 ${attackerName} ha conquistato la provincia!`
        : winner === "attacker"
            ? `⚔ ${attackerName} vince il round!`
            : `🛡 ${defenderName} resiste!`;

    // Crea le righe di confronto dadi
    const diceRows = attackerDices.map((d, i) => {
        const def = defenderDices[i];
        if (def === undefined) return "";
        const aWins = d > def;
        return `
            <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin:6px 0;">
                <div style="width:44px; height:44px; background:#2a2f3e; border:2px solid ${aWins ? "#a7c957" : "#444"};
                            border-radius:8px; display:flex; align-items:center; justify-content:center;
                            font-size:22px; font-weight:bold; color:${aWins ? "#a7c957" : "#fff"};">${d}</div>
                <div style="color:#666; font-size:12px;">vs</div>
                <div style="width:44px; height:44px; background:#2a2f3e; border:2px solid ${!aWins ? "#4488ff" : "#444"};
                            border-radius:8px; display:flex; align-items:center; justify-content:center;
                            font-size:22px; font-weight:bold; color:${!aWins ? "#4488ff" : "#fff"};">${def}</div>
            </div>
        `;
    }).join("");

    result.innerHTML = `
        <div style="background:#1a1f2e; border:2px solid ${winnerColor}; border-radius:16px;
                    padding:32px 40px; min-width:340px; text-align:center; color:#fff;">

            <div style="font-size:18px; font-weight:bold; color:${winnerColor}; margin-bottom:20px;">
                ${winnerText}
            </div>

            <div style="display:flex; justify-content:center; gap:32px; margin-bottom:16px; font-size:13px; color:#888;">
                <div>⚔ ${attackerName}</div>
                <div>🛡 ${defenderName}</div>
            </div>

            ${diceRows}

            <div style="margin-top:16px; font-size:13px; color:#888;">
                Perdite: <span style="color:#ff6b6b;">⚔ -${attackerLosses}</span>
                &nbsp;|&nbsp;
                <span style="color:#6bb5ff;">🛡 -${defenderLosses}</span>
            </div>

${provinceConquered && isAttacker && !autoMoved ? `
    <div style="margin-top:24px; border-top:1px solid #333; padding-top:20px;">
        <div style="font-size:14px; color:#ccc; margin-bottom:12px;">
            Quante truppe vuoi spostare nella nuova provincia?
        </div>
        <div style="display:flex; align-items:center; gap:12px; justify-content:center; margin-bottom:8px;">
            <span style="color:#888; font-size:13px;">${minMovableTroops}</span>
            <input type="range" id="troop-move-slider"
                   min="${minMovableTroops}" max="${maxMovableTroops}"
                   value="${minMovableTroops}"
                   style="flex:1; accent-color:#a7c957;">
            <span style="color:#888; font-size:13px;">${maxMovableTroops}</span>
        </div>
        <div style="font-size:22px; font-weight:bold; color:#a7c957; margin-bottom:16px;">
            <span id="troop-move-value">${minMovableTroops}</span> truppe
        </div>
        <button id="confirm-move-btn"
            style="background:#a7c957; color:#000; border:none; border-radius:8px;
                   padding:12px 32px; font-size:15px; cursor:pointer;
                   font-family:inherit; width:100%; font-weight:bold;">
            Sposta Truppe
        </button>
    </div>
` : provinceConquered && isAttacker && autoMoved ? `
    <div style="margin-top:16px; color:#a7c957; font-size:13px;">
        La tua unica truppa si è spostata nella nuova provincia.
    </div>
` : provinceConquered ? `
    <div style="margin-top:16px; color:#888; font-size:13px;">
        ${attackerName} sta scegliendo quante truppe spostare...
    </div>
` : `
    <button id="close-result-btn"
        style="margin-top:20px; background:#2a2f3e; color:#ccc; border:1px solid #444;
               border-radius:8px; padding:10px 28px; font-size:14px; cursor:pointer;
               font-family:inherit;">
        Chiudi
    </button>
`}
        </div>
    `;

    document.body.appendChild(result);

    // Slider
    const slider = result.querySelector("#troop-move-slider");
    const valueEl = result.querySelector("#troop-move-value");
    if (slider) {
        slider.addEventListener("input", () => {
            valueEl.textContent = slider.value;
        });
    }

    // Conferma spostamento
    const confirmMoveBtn = result.querySelector("#confirm-move-btn");
    if (confirmMoveBtn) {
        confirmMoveBtn.addEventListener("click", () => {
            const troops = parseInt(slider.value);
            socket.emit("confirm_troop_move", { roomId: getRoomId(), troops });
            result.remove();
        });
    }

    // Chiudi senza conquista
    const closeBtn = result.querySelector("#close-result-btn");
    if (closeBtn) {
        closeBtn.addEventListener("click", () => result.remove());
    }

    // Gli spettatori e il difensore vedono il modal chiudersi automaticamente
    if (!isAttacker || !provinceConquered) {
        setTimeout(() => result.remove(), 4000);
    }
}

function turnMessage(turnCounter, isPlacement, isMyTurn = false) {
    const banner = document.getElementById("turn-banner");
    banner.style.display = "block";
    banner.style.opacity = "1";
    if (isPlacement) {
        banner.textContent = "⚔ PIAZZAMENTO TRUPPE ⚔";
        // rimane visibile, non sparisce da solo
    } else if (isMyTurn) {
        banner.textContent = "⚔ È IL TUO TURNO ⚔";
        setTimeout(() => {
            banner.style.opacity = "0";
            setTimeout(() => { banner.style.display = "none"; }, 500);
        }, 2500);
    }
}

function showModal() {
    overlay.style.display = "flex";
    pageContent.classList.add("blur");
}

function hideModal() {
    overlay.style.display = "none";
    pageContent.classList.remove("blur");
}

function applyPlayerColor(continent) {
    const color = continentColors[continent] || '#ffffff';
    document.getElementById("pp-name").style.color = color;
    document.getElementById("pp-continent").style.color = color;
}

function checkGameState() {
    if (roomId && socket.connected) {
        socket.emit("check_turn_order_status", { roomId });
    }
}

function getRoomId() {
    const rid = sessionStorage.getItem("roomId")
        || localStorage.getItem("roomId")
        || new URLSearchParams(window.location.search).get("roomId")
        || new URLSearchParams(window.location.search).get("id");
    console.log("[getRoomId]", rid);
    return rid;
}

function startGame(turnOrder) {
    gameHasStarted = true;
    window._turnOrderDetails = turnOrder; // ← salva qui pure
    sessionStorage.setItem("gameStarted", "true");
    hideModal();

    if (pendingTroops !== null) {
        applyPlacementStart(pendingTroops);
        pendingTroops = null;
    }
}

function attack(attackerTroops, defenderTroops) {
    socket.emit("win_chance", { attackerTroops, defenderTroops });
}

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

function applyPlacementStart(troops) {
    placementPhase = true;
    troopsToPlace = troops;
    troopsToPlaceEl.textContent = troopsToPlace;
    placementBanner.style.display = "block";
    turnMessage(turnCounter, true); // mostra "TROOPS ASSIGNMENT TURN" a tutti
}

// stato locale dell'attacco
let attackState = {
    phase: null,           // null | "selecting_target"
    fromProvinceId: null,
    attackableIds: []
};

function handleProvinceClick(provinceId) {

    // --- FASE PIAZZAMENTO ---
    if (placementPhase) {
        const province = provinces[provinceId];
        const myName = sessionStorage.getItem("playerName");
        const myContinent = sessionStorage.getItem("playerContinent");

        const isMyContinent = province.continent === myContinent;
        const isConquered = province.owner === myName;

        if (!isMyContinent && !isConquered) return;
        if (troopsToPlace <= 0) return;
        socket.emit("place_troop", { provinceId, roomId: getRoomId() });
        return;
    }
    // --- SOLO SE È IL MIO TURNO ---
    if (currentPlayer !== socket.id) return;

    const province = provinces[provinceId];
    const myName = sessionStorage.getItem("playerName");

    // --- FASE 1: selezione provincia attaccante ---
    if (attackState.phase === null) {
        // deve essere mia e avere almeno 2 truppe
        if (province.owner !== myName) return;
        if ((province.troops || 0) < 1) return;

        attackState.fromProvinceId = provinceId;
        attackState.phase = "selecting_target";

        // evidenzia la provincia selezionata
        document.getElementById(provinceId).classList.add("selected-attacker");

        // chiedi al server le province attaccabili
        socket.emit("get_attackable_provinces", {
            provinceId,
            roomId: getRoomId()
        });
        return;
    }

    // --- FASE 2: selezione bersaglio ---
    if (attackState.phase === "selecting_target") {

        // click sulla stessa provincia = deseleziona
        if (provinceId === attackState.fromProvinceId) {
            resetAttackState();
            return;
        }

        // click su una provincia non attaccabile = ignora
        if (!attackState.attackableIds.includes(provinceId)) return;

        // attacca!
        socket.emit("attack", {
            fromProvinceId: attackState.fromProvinceId,
            toProvinceId: provinceId,
            roomId: getRoomId()
        });

        resetAttackState();
    }
}

// ricevi le province attaccabili dal server e aggiorna la grafica
socket.on("attackable_provinces", ({ fromProvinceId, attackable }) => {
    attackState.attackableIds = attackable;

    // attenua tutte le province, poi evidenzia solo le attaccabili
    Object.keys(provinces).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === fromProvinceId) return; // già con selected-attacker
        if (attackable.includes(id)) {
            el.classList.add("attackable");
        } else {
            el.classList.add("dimmed");
        }
    });
});

// Ricevi alert di attacco
socket.on("under_attack", ({ attackerName, fromProvinceId, toProvinceId }) => {
    const alert = document.createElement("div");
    alert.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #8b0000 0%, #ff0000 50%, #8b0000 100%);
        color: white;
        padding: 30px 50px;
        border-radius: 15px;
        z-index: 1000;
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        box-shadow: 0 0 50px rgba(255, 0, 0, 0.8);
        animation: pulse 0.5s ease-in-out;
    `;
    alert.textContent = `⚠️ ATTACCO! ${attackerName} ti sta attaccando!`;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
});


// pulizia stato attacco
function resetAttackState() {
    attackState.phase = null;
    attackState.fromProvinceId = null;
    attackState.attackableIds = [];

    document.querySelectorAll(".province-fill").forEach(el => {
        el.classList.remove("selected-attacker", "attackable", "dimmed");
    });
}

function updateTroopMarker(provinceId, troops, ownerName) {
    const svgEl = document.querySelector("svg");
    const provinceEl = document.getElementById(provinceId);
    if (!provinceEl || !svgEl) return;

    if (ownerName) {
        // Trova il continente del proprietario dai turnOrderDetails
        const ownerEntry = window._turnOrderDetails?.find(p => p.name === ownerName);
        if (ownerEntry && continentColors[ownerEntry.continent]) {
            provinceEl.setAttribute("fill", continentColors[ownerEntry.continent]);
        }
    }

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