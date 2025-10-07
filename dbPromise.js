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

// Optional: log when a connection is made (useful for debugging)
pool.on('connection', (connection) => {
  console.log('✅ New MySQL connection established');
});

// Wrapper function that logs query duration and content
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const [rows] = await pool.query(sql, params);
    const duration = Date.now() - start;

    if (duration > 500) {
      // Warn about slow queries
      console.warn(`⚠️  [SLOW QUERY: ${duration}ms] ${sql}`);
    }

    return rows;
  } catch (error) {
    console.error(`❌ [QUERY ERROR] ${sql}`, error.message);
    throw error;
  }
}

module.exports = {pool, query};
