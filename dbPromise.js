const mysql = require('mysql2/promise');
const os = require('os');
require('dotenv').config();

// Get the server's IP address
const serverIP = os.networkInterfaces()['eth0']?.find(interface => interface.family === 'IPv4')?.address || 'localhost';

// Determine which host to use
const host = (serverIP === '139.59.60.20') ? 'localhost' : '139.59.60.20';

// MySQL connection setup
const pool = mysql.createPool({
    host: host,  // Dynamically set the host based on the server IP
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    queueLimit: 0,
    timezone: "+03:00"
});

module.exports = pool;
