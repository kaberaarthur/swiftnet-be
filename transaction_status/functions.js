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
        // console.log('✅ Payment found:', rows[0]);
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

// Function to send one sms
async function sendSmsViaAfricastalking({ message, phone, companyId }) {
  try {
    // Get Company details
    const [rows] = await db.execute(
        `SELECT * FROM companies WHERE id = ? LIMIT 1`,
        [companyId]
    );

    if (rows.length > 0) {
        console.log(rows[0].africas_talking_sender_id);
    } else {
        return res.status(403).json({ 
            message: "We don't know who you represent" 
        });
    }

    const company = rows[0];

    const payload = {
      username: company.africas_talking_username,
      message: message,
      senderId: company.africas_talking_sender_id,
      phoneNumbers: [phone],
    };

    const response = await axios.post(
      'https://api.africastalking.com/version1/messaging/bulk',
      payload,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'apiKey': company.africas_talking_key
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error(`Error sending SMS to ${phone}:`, error.response?.data || error.message);
    throw error;
  }
};


async function checkCompanyPaymentDetails(recipient_company_id) {
  try {
    // Fetch company info
    const [rows] = await db.execute(
      'SELECT paybill_no, account_no, forward_payment FROM companies WHERE id = ?',
      [recipient_company_id]
    );

    // No company found
    if (rows.length === 0) {
      return {
        success: false,
        message: 'Company not found',
      };
    }

    const { paybill_no, account_no, forward_payment } = rows[0];

    // Case: forward_payment is 0
    if (forward_payment === 0) {
      return {
        success: true,
        message: 'This organization does not require payments to be forwarded',
      };
    }

    // Case: forward_payment is 1 but some data is missing
    if (forward_payment === 1) {
      if (!paybill_no || !account_no) {
        return {
          success: false,
          message: 'Missing paybill_no or account_no',
          data: {
            paybill_no,
            account_no,
          },
        };
      }

      // All valid, return the details
      return {
        success: true,
        message: 'Forwarding required',
        data: {
          paybill_no,
          account_no,
        },
      };
    }

    // Unexpected forward_payment value
    return {
      success: false,
      message: `Unexpected forward_payment value: ${forward_payment}`,
    };
  } catch (err) {
    return {
      success: false,
      message: 'Error fetching company details',
      error: err.message,
    };
  }
}

async function forwardPayments(paybill_no, account_no, amountPaid) {
  const amountToTransfer = parseFloat(amountPaid);

  const developerPaybillNumber = "247247";
  const developerAccountNumber = "0710165089375";

  // CASE: amountPaid < 100, send full amount to company
  if (amountToTransfer < 100) {
    console.log('Amount < 100: Sending full amount to company only');

    try {
      const companyResponse = await axios.post('http://localhost:8000/b2b/b2b-payment', {
        company_id: 2,
        paybill_no: String(paybill_no),
        account_no: String(account_no),
        amount: Math.floor(amountToTransfer)  // Ensure it's a whole number
      });

      console.log('Company payment response:', companyResponse.data);
    } catch (error) {
      console.error('Error sending full payment to company:', error.message);
    }

    return;
  }

  console.log('Amount greater than 100: Sending full amount to company plus developer commission');

  // CASE: amountPaid >= 100, split payment
  const finalAmountToTransfer = Math.floor(amountToTransfer * 0.99); // 99%
  const developerCommission = Math.floor(amountToTransfer * 0.01);    // 1%

  console.log('Amount to Transfer:', finalAmountToTransfer);
  console.log('Developer Commission:', developerCommission);

  // Company transfer
  try {
    const companyResponse = await axios.post('http://localhost:8000/b2b/b2b-payment', {
      company_id: 2,
      paybill_no: String(paybill_no),
      account_no: String(account_no),
      amount: finalAmountToTransfer
    });

    console.log('Company payment response:', companyResponse.data);
  } catch (error) {
    console.error('Error sending payment to company:', error.message);
  }

  // Developer commission
  try {
    const devResponse = await axios.post('http://localhost:8000/b2b/b2b-payment', {
      company_id: 2,
      paybill_no: developerPaybillNumber,
      account_no: developerAccountNumber,
      amount: developerCommission
    });

    console.log('Developer payment response:', devResponse.data);
  } catch (error) {
    console.error('Error sending payment to developer:', error.message);
  }
}


// Usage
module.exports = {
    generateDarajaAccessToken, 
    getDarajaInitiatorPassword,
    getSecurityCredential,
    getCustomerById,
    logTransactionError,
    waitForPaymentReceipt,
    sendSmsViaAfricastalking,
    checkCompanyPaymentDetails,
    forwardPayments
};
