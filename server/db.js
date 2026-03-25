const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "127.0.0.1",
    port: 3306,
    user: "dominium",
    password: "dominium123",
    database: "dominium",
    waitForConnections: true,
    connectionLimit: 10
});

module.exports = pool;