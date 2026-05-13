const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("./db");

router.post("/register", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.json({ success: false, message: "Enter email and password" });

    try {
        const [rows] = await db.execute("SELECT idU FROM Utente WHERE email = ?", [email]);
        if (rows.length > 0)
            return res.json({ success: false, message: "Email already registered" });

        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            "INSERT INTO Utente (email, password, username) VALUES (?, ?, NULL)",
            [email, hash]
        );

        // Invalida eventuale sessione precedente
        const activeSessions = req.app.locals.activeSessions;
        if (activeSessions.has(user.email)) {
            const oldSessionId = activeSessions.get(user.email);
            req.sessionStore.destroy(oldSessionId, () => {});

            // Trova e disconnetti il socket associato alla vecchia sessione
            const io = global._io;
            if (io) {
                io.sockets.sockets.forEach((s) => {
                    if (s.request.session.id === oldSessionId) {
                        s.emit("session_expired");
                        s.disconnect(true);
                    }
                });
            }
        }

        req.session.idU = result.insertId;
        req.session.email = email;
        req.session.save(() => {
            activeSessions.set(email, req.session.id);
            res.json({ success: true });
        });

    } catch (err) {
        console.error("[REGISTER]", err);
        res.json({ success: false, message: "Server error: " + err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.json({ success: false, message: "Enter email and password" });

    try {
        const [rows] = await db.execute("SELECT * FROM Utente WHERE email = ?", [email]);
        if (rows.length === 0)
            return res.json({ success: false, message: "User not found" });

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.json({ success: false, message: "Incorrect password" });

        // Blocca se già loggato da un'altra sessione attiva
        const activeSessions = req.app.locals.activeSessions;
        if (activeSessions.has(user.email)) {
            return res.json({ success: false, message: "An account is already logged in with this email" });
        }

        req.session.idU = user.idU;
        req.session.email = user.email;
        req.session.save(() => {
            activeSessions.set(user.email, req.session.id);
            res.json({ success: true });
        });

    } catch (err) {
        console.error("[LOGIN]", err);
        res.json({ success: false, message: err.code + " – " + err.message });
    }
});

router.get("/session", (req, res) => {
    if (!req.session || !req.session.idU) {
        return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, idU: req.session.idU, email: req.session.email });
});

router.post("/logout", (req, res) => {
    const activeSessions = req.app.locals.activeSessions;
    const email = req.session?.email;
    req.session.destroy(() => {
        if (email) activeSessions.delete(email);
        res.json({ success: true });
    });
});

// In fondo ad auth.js, prima di module.exports

router.post("/username", async (req, res) => {
    if (!req.session || !req.session.idU) {
        return res.json({ success: false, message: "Not logged in" });
    }

    const { username } = req.body;
    if (!username || typeof username !== "string") {
        return res.json({ success: false, message: "Invalid username" });
    }

    const trimmed = username.trim().substring(0, 20);

    try {
        await db.execute(
            "UPDATE Utente SET username = ? WHERE idU = ?",
            [trimmed, req.session.idU]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("[USERNAME]", err);
        res.json({ success: false, message: err.message });
    }
});

// Funzioni interne chiamate dal server (non route HTTP)
async function saveGameToDB(room, roomId, reason, gameStartTime) {
    try {
        const durata = Math.round((Date.now() - gameStartTime) / 1000);

        const [result] = await db.execute(
            "INSERT INTO Partita (durata, tipoFine) VALUES (?, ?)",
            [durata, reason]
        );
        const idP = result.insertId;

        await saveStatisticheToDB(room, idP, reason);
        return idP;
    } catch (err) {
        console.error("[SAVE_GAME]", err);
    }
}

async function saveStatisticheToDB(room, idP, reason) {
    try {
        const results = room.gameResults;
        if (!results || !Array.isArray(results.players)) return;

        for (let i = 0; i < results.players.length; i++) {
            const player = results.players[i];

            // Recupera idU dal socket della sessione
            const playerDetail = room.turnOrderDetails.find(p => p.name === player.name);
            if (!playerDetail) continue;

            const playerSocket = global._io?.sockets?.sockets?.get(playerDetail.socketId);
            const idU = playerSocket?.request?.session?.idU;
            if (!idU) continue;

            const posizione = i + 1;
            const vittoria = (i === 0 && (reason === "conquest" || reason === "time")) ? 1 : 0;
            const province = player.provinces || 0;
            const truppe = player.troops || 0;

            await db.execute(
                "INSERT INTO Statistiche (idU, idP, posizione, vittoria, province, truppe) VALUES (?, ?, ?, ?, ?, ?)",
                [idU, idP, posizione, vittoria, province, truppe]
            );
        }
    } catch (err) {
        console.error("[SAVE_STATISTICHE]", err);
    }
}

module.exports = router;
module.exports.saveGameToDB = saveGameToDB;
