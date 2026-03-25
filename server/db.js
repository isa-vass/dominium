const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",       // XAMPP di default non ha password
    database: "dominium",
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool;