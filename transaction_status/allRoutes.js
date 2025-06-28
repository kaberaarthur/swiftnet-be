const express = require('express');
const router = express.Router();
const axios = require('axios');
const moment = require('moment');
const db = require('../dbPromise');

// Import your functions
const {
  getSecurityCredential,
  generateDarajaAccessToken,
  getDarajaInitiatorPassword,
  getCustomerById,
  logTransactionError,
  waitForPaymentReceipt
} = require('./functions');

// GET /credential/:id — Example endpoint
router.get('/credential/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the raw password from DB (you may already have this function)
    const password = await getDarajaInitiatorPassword(id); // <- this must return the raw string password

    if (!password) {
      return res.status(404).json({ error: 'Password not found for the given ID.' });
    }

    console.log("Initiator Password: ", password);

    // Encrypt the password using your PHP logic
    const encrypted = await getSecurityCredential(password);

    // Log it to console
    console.log(`Encrypted credential for ID ${id}:`, encrypted);

    // Respond to client
    res.json({ SecurityCredential: encrypted });

  } catch (error) {
    console.error('Error generating credential:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/', async (req, res) => {
  const { transaction_code, company_id, customer_id } = req.body;

  // Step 1: Check if both parameters have been attached
  if (!transaction_code || !company_id || !customer_id) {
    return res.status(400).json({ error: 'Your request is invalid' });
  }

    // Step 2: Check for duplicate in both tables
    const [pppoe] = await db.execute(
      'SELECT id FROM pppoe_payments WHERE MpesaReceiptNumber = ? LIMIT 1',
      [transaction_code]
    );
    const [payments] = await db.execute(
      'SELECT id FROM payments WHERE MpesaReceiptNumber = ? LIMIT 1',
      [transaction_code]
    );

    if (pppoe.length > 0 || payments.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'That transaction has already been consumed, you cannot use it again',
      });
    };

    // Collect info regarding the customer from the db
    const user = await getCustomerById(customer_id);

    if (!user) {
      return res.status(404).json({ message: 'User does not exist' });
    } else {
        console.log(user.secret);
    }

  try {
    // Step 3: Fetch initiator password from DB
    const password = await getDarajaInitiatorPassword(company_id);

    if (!password) {
      return res.status(404).json({ error: 'Initiator password not found for company_id' });
    }

    // Step 4: Encrypt the password using public key
    const SecurityCredential = getSecurityCredential(password);

    // Step 5: Get access token
    const accessToken = await generateDarajaAccessToken();

    // Step 6: Prepare M-Pesa Transaction Status payload
    const data = {
      Initiator: 'Swiftnetweb',
      SecurityCredential,
      CommandID: 'TransactionStatusQuery',
      TransactionID: transaction_code,
      OriginatorConversationID: `AG_${Date.now()}`, // optional unique ID
      PartyA: '4150219',
      IdentifierType: '4',
      ResultURL: 'https://6fb8-105-163-2-212.ngrok-free.app/transaction-status/callback',
      QueueTimeOutURL: 'https://6fb8-105-163-2-212.ngrok-free.app/transaction-status/callback',
      Remarks: 'Checking transaction status',
      Occasion: 'OK',
    };

    // Step 7: Send request to Safaricom
    const response = await axios.post(
      'https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query',
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // Add a way to confirm or reject the transaction
    // 1. Wait for transaction from callback
    const payment = await waitForPaymentReceipt(transaction_code);

    if (!payment) {
        console.log('❌ No payment found after waiting.');
    };

    // 2. Confirm if Amount equals or doubles the required transaction fee
    const amountPaid = parseFloat(payment.Amount);
    const planFee = parseFloat(user.plan_fee);

    if (amountPaid >= planFee) {
        const multiplier = amountPaid / planFee;

        if (Number.isInteger(multiplier)) {
            console.log(`✅ Payment is sufficient for ${multiplier} subscription(s).`);
            // You can now process `multiplier` number of subscriptions
        } else {
            console.log(`⚠️ Payment is more than plan fee, but not a clean multiple.`);
            // Maybe allow 1 subscription and flag the remainder?
        }
    } else {
        console.log('❌ Payment is less than the required plan fee.');
        res.status(400).json({ success: false, message: '❌ Payment is less than the required plan fee.' });
    }


    res.json(response.data);
  } catch (error) {
    console.error('❌ M-Pesa transaction status error:', error.message);
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Safaricom's IP Adressess
// Only allow callbacks from these addresses
const allowedIPs = [
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
  '196.201.212.69'
];


router.post('/callback', async (req, res) => {
  // Check to ensure only Safaricom can make the api call to the callback url
  const clientIP = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');

  if (!allowedIPs.includes(clientIP)) {
    console.log(`❌ Unauthorized IP: ${clientIP}`);
    return res.status(403).end(); // Silent denial
  }

  try {
    const result = req.body.Result;

    // Step 1: Validate ResultCode
    if (!result || result.ResultCode !== 0) {
        await logTransactionError(
            '❌ Invalid Transaction ResultCode',
            req.body
        );
        return res.status(200).end();
    }

    const params = result.ResultParameters?.ResultParameter || [];

    // Step 2: Extract ReceiptNo and Amount
    const receipt = params.find(p => p.Key === 'ReceiptNo')?.Value;
    const amount = params.find(p => p.Key === 'Amount')?.Value;
    const rawTimestamp = params.find(p => p.Key === 'FinalisedTime')?.Value;
    const debitParty = params.find(p => p.Key === 'DebitPartyName')?.Value;

    if (!receipt) {
      return res.status(400).json({ message: 'No ReceiptNo found in callback.' });
    }

    // Step 3: Check for duplicate in both tables
    const [pppoe] = await db.execute(
      'SELECT id FROM pppoe_payments WHERE MpesaReceiptNumber = ? LIMIT 1',
      [receipt]
    );
    const [payments] = await db.execute(
      'SELECT id FROM payments WHERE MpesaReceiptNumber = ? LIMIT 1',
      [receipt]
    );

    if (pppoe.length > 0 || payments.length > 0) {
      return res.status(409).json({
        message: 'That transaction has already been consumed, you cannot use it again',
      });
    };

    const completedAt = moment(rawTimestamp, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

    // Step 4: Log Amount
    console.log('✅ Amount: ', amount);
    console.log('✅ Transaction Completed at: ', completedAt);

    // Step 5: Log Phone and Name from DebitPartyName
    const [phone, name] = debitParty.split(' - ');
    console.log('📱 Phone:', phone);
    console.log('👤 Name:', name);
    

    // Include a step to store the data inside the DB
    await db.execute(
        `INSERT INTO pppoe_payments (Amount, Phone, MpesaReceiptNumber, timestamp) VALUES (?, ?, ?, ?)`,
        [amount, phone, receipt, completedAt]
    );


    // Step 6: Final response
    res.status(200).json({ message: 'Transaction processed successfully.' });

  } catch (error) {
    console.error('❌ Error handling transaction callback:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
