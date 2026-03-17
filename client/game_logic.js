socket.on("roll_dice", () => {
    diceResult = sessionStorage.getItem("diceResult");
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
