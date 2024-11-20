const mysql = require('mysql2/promise');

// MySQL connection setup
const pool = mysql.createPool({
    host: 'localhost',
    user: 'swiftnet',
    password: 'nOIqSz3aGgYM9z7J',
    database: 'swiftnet'
});

module.exports = pool;