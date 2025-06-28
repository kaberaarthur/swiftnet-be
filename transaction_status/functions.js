const axios = require('axios');
const db = require('../dbPromise');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function generateDarajaAccessToken() {
  const consumerKey = "bo765YbUepDR6iAY9o1MiUUohgzgHuowaaHnsC1fSO4ZMSCq";
  const consumerSecret = "AzDktYDi52YE5eD8cBL4VAUsEumdwu2bhdZCNr1cAIV2Cfhq1BrWA2Q8kXW5gvJi";
  const url = "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    const accessToken = response.data.access_token;
    console.log("Access Token:", accessToken);
    return accessToken;
  } catch (error) {
    console.error("Failed to get access token:", error.response?.data || error.message);
    throw error;
  }
}

async function getDarajaInitiatorPassword(id) {
  try {
    const [rows] = await db.execute(
      'SELECT mpesa_initiator_password FROM companies WHERE id = ?',
      [id]
    );

    if (rows.length > 0) {
      return rows[0].mpesa_initiator_password;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Database query failed:', error);
    throw error;
  }
}

function getSecurityCredential(password) {
  const certPath = path.join(__dirname, 'ProductionCertificate.cer');

  // Load the public key from the certificate file
  const publicKey = fs.readFileSync(certPath, 'utf8');

  // Encrypt the password using RSA and PKCS1 padding
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password)
  );

  // Return base64-encoded credential
  return encrypted.toString('base64');
}

async function logTransactionError(message, data) {
  const logDir = path.join(__dirname, '..', 'logs');
  const now = new Date();

  // Ensure logs directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }

  const logFile = path.join(logDir, 'pppoe_transaction_check.log');

  // Delete log file if older than 7 days
  if (fs.existsSync(logFile)) {
    const stats = fs.statSync(logFile);
    const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageInDays > 7) {
      fs.unlinkSync(logFile); // delete old file
    }
  }

  // Format: [timestamp] message | JSON data on one line
  const logEntry = `[${now.toISOString()}] ${message} | ${JSON.stringify(data)}\n`;

  // Append to the log file
  fs.appendFileSync(logFile, logEntry, 'utf8');
}

async function getCustomerById(id) {
  const [rows] = await db.execute(
    'SELECT * FROM pppoe_clients WHERE id = ?',
    [id]
  );

  if (rows.length === 0) {
    return null; // user not found
  }

  return rows[0];
}

// Wait for Callback from Daraja
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPaymentReceipt(receipt) {
  // Step 1: Initial wait of 2 seconds
  await wait(2000);

  // Step 2: Check once every second, up to 6 times
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const [rows] = await db.execute(
        'SELECT * FROM pppoe_payments WHERE MpesaReceiptNumber = ?',
        [receipt]
      );

      if (rows.length > 0) {
        console.log('✅ Payment found:', rows[0]);
        return rows[0];
      }

      // Wait 1 second before next check (unless it's the last attempt)
      if (attempt < 5) await wait(1000);
    } catch (error) {
      console.error('❌ Error querying DB:', error);
      return null;
    }
  }

  console.log('⏱️ Timeout: Payment not found after 6 checks.');
  return null;
}

// Usage
module.exports = {
    generateDarajaAccessToken, 
    getDarajaInitiatorPassword,
    getSecurityCredential,
    getCustomerById,
    logTransactionError,
    waitForPaymentReceipt
};
