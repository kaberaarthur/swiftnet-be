const mysql = require('mysql2/promise');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

// Get the server's IP address
const serverIP = os.networkInterfaces()['eth0']?.find(interface => interface.family === 'IPv4')?.address || 'localhost';

// Determine which host to use
const host = (serverIP === '139.59.60.20') ? 'localhost' : '139.59.60.20';

// MySQL connection setup
const pool = mysql.createPool({
    host: host,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 10000,
    queueLimit: 0,
    timezone: "+03:00"
});

// Log file path
const logFile = 'mysqlresourcemonitor.log';

// Function to write logs to file (with datetime prefix)
function writeToLog(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logEntry, 'utf8');
}

// Log when a connection is made
pool.on('connection', (connection) => {
    const message = '✅ New MySQL connection established';
    console.log(message);
    writeToLog(message);
});

// Wrapper function that logs query duration and content
async function query(sql, params = []) {
    const start = Date.now();
    try {
        const [rows] = await pool.query(sql, params);
        const duration = Date.now() - start;

        // Format params for logging (avoid logging sensitive data if needed)
        const paramsLog = params.length > 0 ? `[params: [${params.join(', ')}]]` : '';

        if (duration > 500) {
            // Warn about slow queries (console + file)
            const message = `⚠️ [SLOW QUERY: ${duration}ms] ${sql} ${paramsLog}`;
            console.warn(message);
            writeToLog(message);
        } else {
            // Log normal queries (file only)
            const message = `[QUERY: ${duration}ms] ${sql} ${paramsLog}`;
            writeToLog(message);
        }

        return rows;
    } catch (error) {
        // Log errors (console + file)
        const paramsLog = params.length > 0 ? `[params: [${params.join(', ')}]]` : '';
        const message = `❌ [QUERY ERROR: ${duration}ms] ${sql} ${paramsLog} - ${error.message}`;
        console.error(message);
        writeToLog(message);
        throw error;
    }
}

module.exports = { pool, query };