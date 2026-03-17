        // LOGICA PANEL INIZIALE PER ORDINE DEI TURNI
        const roomId = sessionStorage.getItem("roomId"); // o come lo stai salvando
        const overlay = document.getElementById("overlay");
        const pageContent = document.getElementById("page-content");
        const btnRoll = document.getElementById("btn-roll-dice");
        const waitingMsg = document.getElementById("waiting-msg");
        const diceResultDisplay = document.getElementById("dice-result-display");
        const myRollValue = document.getElementById("my-roll-value");
        const diceRollsList = document.getElementById("dice-rolls-list");
        const modalTitle = document.getElementById("modal-title");
        const modalDesc = document.getElementById("modal-desc");

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

        // --- Tiro del dado ---
        btnRoll.addEventListener("click", () => {
            btnRoll.disabled = true;
            btnRoll.textContent = "Dado tirato!";
            socket.emit("roll_for_turn_order", { roomId });
        });

        // Aggiorna la lista quando un giocatore tira
        socket.on("player_rolled", ({ socketId, name, roll }) => {
            // Aggiorna o aggiunge la riga nella lista
            let row = document.getElementById(`roll-${socketId}`);
            if (!row) {
                row = document.createElement("div");
                row.id = `roll-${socketId}`;
                row.style.cssText = "padding:6px 0; color:#ffcccc; font-size:0.95em;";
                diceRollsList.appendChild(row);
            }
            row.textContent = `${name}: 🎲 ${roll}`;

            // Mostra il proprio risultato
            if (socketId === socket.id) {
                diceResultDisplay.style.display = "block";
                myRollValue.textContent = roll;
                waitingMsg.style.display = "block";
            }
        });

        // Pareggio: solo i giocatori pareggiati ritirano
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
        socket.on("turn_order_decided", ({ turnOrder }) => {
            modalTitle.textContent = "Ordine Turni Stabilito!";
            modalDesc.textContent = "La partita sta per iniziare...";
            diceRollsList.innerHTML = "";
            btnRoll.style.display = "none";
            waitingMsg.style.display = "none";

            turnOrder.forEach((player, index) => {
                const row = document.createElement("div");
                row.style.cssText = "padding:5px 0; color:#ffcccc; font-size:0.95em;";
                const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
                row.textContent = `${medal} ${player.name}`;
                diceRollsList.appendChild(row);
            });

            // Chiudi il modal dopo 3 secondi e avvia il gioco
            setTimeout(() => {
                hideModal();
                startGame(turnOrder); // tua funzione per iniziare il gioco
            }, 3000);
        });
        //FINE LOGICA PANEL INIZIALE PER ORDINE DEI TURNI

socket.on("show_action_box", () => {
    showModal();
});

socket.on("hide_action_box", () => {
    hideModal();
});

function attack(attackerTroops, defenderTroops) {
    socket.emit("win_chance", {
        attackerTroops,
        defenderTroops
    });
}

socket.on("battle_result", ({ winner }) => {
    if (winner === "attacker") {
        console.log("L'attaccante ha vinto!");
        // aggiorna UI
    } else {
        console.log("Il difensore ha resistito!");
        // aggiorna UI
    }
});
