const mysql = require('mysql2');
const os = require('os');

// Get the server's IP address
const serverIP = os.networkInterfaces()['eth0']?.find(interface => interface.family === 'IPv4')?.address || 'localhost';

// Determine which host to use
const host = (serverIP === '139.59.60.20') ? 'localhost' : '139.59.60.20';

// MySQL connection setup
const db = mysql.createConnection({
    host: host,  // Dynamically set the host based on the server IP
    user: 'swiftnet',
    password: 'nOIqSz3aGgYM9z7J',
    database: 'swiftnet',
    timezone: "+03:00"
});

db.connect((err) => {
    if (err) throw err;
    console.log('Connected to MySQL');
});

module.exports = db;
