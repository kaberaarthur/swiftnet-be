const mysql = require('mysql2/promise');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

// Get the server's IP address
const serverIP =
  os.networkInterfaces()['eth0']?.find((iface) => iface.family === 'IPv4')?.address || 'localhost';

// Determine which host to use
const host = serverIP === '139.59.60.20' ? 'localhost' : '139.59.60.20';

// MySQL connection setup
const pool = mysql.createPool({
  host,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
  queueLimit: 0,
  timezone: '+03:00',
});

// Log file path
const logFile = 'mysqlresourcemonitor.log';
function writeToLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, 'utf8');
}

// Log when a connection is made
pool.on('connection', () => {
  const message = '✅ New MySQL connection established';
  console.log(message);
  writeToLog(message);
});

// Wrap the default `query` and `execute` methods
const _query = pool.query.bind(pool);
const _execute = pool.execute.bind(pool);

pool.query = async (sql, params = []) => {
  const start = Date.now();
  try {
    const [rows] = await _query(sql, params);
    const duration = Date.now() - start;

    const paramsLog = params.length ? `[params: [${params.join(', ')}]]` : '';
    const message = duration > 1000
      ? `⚠️ [SLOW QUERY: ${duration}ms] ${sql} ${paramsLog}`
      : `[QUERY: ${duration}ms] ${sql} ${paramsLog}`;

    if (duration > 500) console.warn(message);
    writeToLog(message);

    return [rows];
  } catch (error) {
    const paramsLog = params.length ? `[params: [${params.join(', ')}]]` : '';
    const duration = Date.now() - start;
    const message = `❌ [QUERY ERROR: ${duration}ms] ${sql} ${paramsLog} - ${error.message}`;
    console.error(message);
    writeToLog(message);
    throw error;
  }
};

pool.execute = async (sql, params = []) => {
  const start = Date.now();
  try {
    const [rows] = await _execute(sql, params);
    const duration = Date.now() - start;

    const paramsLog = params.length ? `[params: [${params.join(', ')}]]` : '';
    const message = duration > 500
      ? `⚠️ [SLOW EXECUTE: ${duration}ms] ${sql} ${paramsLog}`
      : `[EXECUTE: ${duration}ms] ${sql} ${paramsLog}`;

    if (duration > 500) console.warn(message);
    writeToLog(message);

    return [rows];
  } catch (error) {
    const paramsLog = params.length ? `[params: [${params.join(', ')}]]` : '';
    const duration = Date.now() - start;
    const message = `❌ [EXECUTE ERROR: ${duration}ms] ${sql} ${paramsLog} - ${error.message}`;
    console.error(message);
    writeToLog(message);
    throw error;
  }
};

// ✅ Export the pool directly — backward compatible
module.exports = pool;
