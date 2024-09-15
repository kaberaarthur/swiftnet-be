const mysql = require('mysql2/promise'); // Use promise-compatible version

// MySQL connection setup
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'swiftnet'
});

module.exports = pool;