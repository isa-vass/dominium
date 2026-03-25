const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("./db");

router.post("/register", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "Inserisci email e password" });
    }

    try {
        const [rows] = await db.execute("SELECT idU FROM Utente WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.json({ success: false, message: "Email già registrata" });
        }

        const hash = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            "INSERT INTO Utente (email, password) VALUES (?, ?)",
            [email, hash]
        );

        req.session.idU = result.insertId;
        req.session.email = email;
        req.session.save(() => {
            res.json({ success: true });
        });

    } catch (err) {
        console.error("[REGISTER]", err);
        res.json({ success: false, message: "Errore del server: " + err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: "Inserisci email e password" });
    }

    try {
        const [rows] = await db.execute("SELECT * FROM Utente WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.json({ success: false, message: "Utente non trovato" });
        }

        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({ success: false, message: "Password errata" });
        }

        req.session.idU = user.idU;
        req.session.email = user.email;
        req.session.save(() => {
            res.json({ success: true });
        });

    } catch (err) {
        console.error("[REGISTER] ERRORE COMPLETO:", err);
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
    req.session.destroy();
    res.json({ success: true });
});

module.exports = router;