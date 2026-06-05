const express = require('express');
const router = express.Router();
const axios = require('axios');
const moment = require('moment');
const db = require('../dbPromise');
const redisClient = require("../services/redis");

const { logBasicAmount } = require('./b2bHelperRoutes'); // Import the helper function

// Import your functions
const {
  getSecurityCredential,
  generateDarajaAccessToken,
  getDarajaInitiatorPassword,
  getCustomerById,
  logTransactionError,
  waitForPaymentReceipt,
  sendSmsViaAfricastalking
} = require('./functions');

router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from Node.js!' });
});

// POST endpoint to send BusinessPayBill request
router.post('/b2b-payment', async (req, res) => {
    const { company_id, paybill_no, account_no, amount } = req.body;
    // const password = await getDarajaInitiatorPassword(company_id);

    // Use the Swiftnet Company ID, To avoid changing for each company
    // const password = await getDarajaInitiatorPassword(2);

    const password = getDarajaInitiatorPassword(2); // Get password for Swiftnet (company_id=2)

    console.log('Received B2B payment request using the Initiator Password:', password);

    if (!password) {
      return res.status(404).json({ error: 'Initiator password not found for company_id' });
    }

    try {
        const accessToken = await generateDarajaAccessToken();
        const securityCredential = getSecurityCredential(password);
        // const securityCredential = getSecurityCredential(")Tr-Jzp3SP28eKG");

        const payload = {
            Initiator: "Swiftnet",
            SecurityCredential: securityCredential,
            CommandID: "BusinessPayBill",
            SenderIdentifierType: "4",
            RecieverIdentifierType: "4",
            Amount: amount,
            PartyA: "4150219", // Your shortcode
            PartyB: String(paybill_no), // Receiver shortcode
            AccountReference: String(account_no),
            Requester: "254700000000",
            Remarks: "OK",
            QueueTimeOutURL: "https://swiftnetmain.twigasoft.xyz/b2b/b2b-result",
            ResultURL: "https://swiftnetmain.twigasoft.xyz/b2b/b2b-result"
        };

        const response = await axios.post(
            'https://api.safaricom.co.ke/mpesa/b2b/v1/paymentrequest',
            payload,
            {
                headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
                }
            }
            );

            res.status(200).json({
            status: 'success',
            data: response.data
        });

    } catch (error) {
        console.error('B2B Error:', error.response?.data || error.message);
        await logTransactionError('b2b_payment', error.message);
        res.status(500).json({ status: 'error', message: 'B2B request failed', error: error.response?.data || error.message });
    }
});


// Store Callback from Daraja
// Safaricom IPs to allow
const allowedIps = [
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69',

  // Localhost (for development/testing)
  // '127.0.0.1',
  // '::1'
];

// Helper to normalize IPs (removes ::ffff: if present)
function normalizeIp(ip) {
  return ip.replace('::ffff:', '');
}

router.post('/b2b-result', async (req, res) => {
  console.log('Start Processing B2B result callback');

  // IP validation
  const rawIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const clientIp = normalizeIp(rawIp);

  // console.log(`➡️ Incoming callback from IP: ${clientIp}`);
  // console.log("➡️ Raw body:", JSON.stringify(req.body, null, 2)); // full payload

  if (!allowedIps.includes(clientIp)) {
    console.warn(`Rejected B2B callback from disallowed IP: ${clientIp}`);
    return res.status(403).json({ message: 'Forbidden: IP not allowed' });
  }

  try {
    const result = req.body.Result;
    if (!result) {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    console.log('✅ Valid B2B callback received:', JSON.stringify(req.body, null, 2));

    logBasicAmount(req.body); // Call the helper function to log BasicAmount

    // Debug TransactionID + ConversationID
    // console.log(`📦 Enqueuing TransactionID=${result.TransactionID}, ConversationID=${result.ConversationID}`);

    // Just enqueue into Redis, don’t touch DB directly
    await redisClient.lPush("b2b_callbacks", JSON.stringify(result));

    // console.log(`Enqueued B2B result: ${result.TransactionID || 'N/A'}`);

    // Always ACK quickly
    res.status(200).json({ message: 'B2B result accepted' });
  } catch (err) {
    console.error('Error queuing B2B result:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;