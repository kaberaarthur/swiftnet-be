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
  waitForPaymentReceipt,
  sendSmsViaAfricastalking,
  checkCompanyPaymentDetails,
  forwardPayments
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

// Process Customer Transaction for PPPoE Subscription Renewal
router.post('/', async (req, res) => {
  const { transaction_code, customer_id } = req.body;
  console.log("Processing Transaction with Mpesa Code: ", transaction_code);

  // Step 1: Check if both parameters have been attached
  if (!transaction_code || !customer_id) {
    return res.status(400).json({ error: 'Your request is invalid' });
  }

  // Collect info regarding the customer from the db
  const user = await getCustomerById(customer_id);

  // Add null check before accessing company_id
  if (!user) {
    console.error('User not found for customer_id:', customer_id);
    return res.status(404).json({ 
      success: false, 
      message: 'Customer not found' 
    });
  } else {
    console.log('User found for customer_id:', { customer_id, user_id: user.id });
  }

  const company_id = user.company_id;

  // Optional: Add additional validation for company_id
  if (!company_id) {
    console.error('User has no company_id:', { customer_id, user_id: user.id });
    return res.status(400).json({ 
      success: false, 
      message: 'Customer has no associated company' 
    });
  }


  // Step 2: Check for duplicate in both tables
  // This feature is targeted at ensuring the user does not use a payment from hotspot to try and cheat the system
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
      message: 'That transaction has already been consumed, you cannot use it again.',
    });
  };

  if (!user) {
    return res.status(404).json({ message: 'User does not exist' });
    // Payments with billrefnumber/accountnumber 'Hotspot' fail here
  } else {
      // This is where that phone number is getting printed
      console.log(user.secret);
  }

  try {
    console.log("Now checking transaction status with Safaricom...");
    // Step 3: Fetch initiator password from DB
    // const password = await getDarajaInitiatorPassword(company_id);
    // use manual company_id to get the password
    const password = await getDarajaInitiatorPassword(2);
    console.log("Initiator Password Fetched: ", password);

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
      ResultURL: 'http://139.59.60.20:8000/transaction-status/callback',
      QueueTimeOutURL: 'http://139.59.60.20:8000/transaction-status/callback',
      Remarks: 'Checking transaction status',
      Occasion: 'OK',
    };

    // Step 7: Send request to Safaricom
    // Daraja sends a separate callback request, so we don't need this response
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

    // Add a way to confirm or reject the transaction - Why are we doing this check, I don't get it.
    // 1. Wait for transaction from callback
    const payment = await waitForPaymentReceipt(transaction_code);
    const paymentDate = moment(payment.timestamp);
    const oneWeekAgo = moment().subtract(7, 'days');

    // Tries to make sure customers cannot reuse old transaction messages
    if (paymentDate.isBefore(oneWeekAgo)) {
        return res.status(403).json({
            success: false,
            message: '⛔ That payment is too old to be used. Please contact customer support.'
        });
    }

    if (!payment) {
        console.log('❌ No payment found after waiting.');
        return res.status(403).json({ success: false, message: 'We could not trace your payment' });
    };

    // 2. Confirm if Amount equals or doubles the required transaction fee
    const amountPaid = parseFloat(payment.Amount);
    const planFee = parseFloat(user.plan_fee);
    const dailyRate = planFee / 30;

    console.log(`💰 Amount Paid: ${amountPaid}, Plan Fee: ${planFee}, Daily Rate: ${dailyRate}`);

    if (amountPaid >= planFee) {
        const baseMonths = 1; // Always start with 1 full month
        const remaining = amountPaid - planFee;

        // Calculate extra days
        const extraDays = Math.floor(remaining / dailyRate);

        console.log(`✅ Payment covers 1 full month + ${extraDays} extra day(s)`);

        // Time setup
        const nowNairobi = moment.tz("Africa/Nairobi");
        const clientEndDateNairobi = moment.tz(user.end_date, "Africa/Nairobi");
        const baseDate = clientEndDateNairobi.isBefore(nowNairobi) ? nowNairobi : clientEndDateNairobi;

        // Add time
        const newEndDate = baseDate.clone().add(baseMonths, "months").add(extraDays, "days");
        const formattedNewEndDate = newEndDate.format("YYYY-MM-DD HH:mm:ss");

        // console.log(`⏳ New subscription end date: ${formattedNewEndDate}`);

        // Update client subscription
        const client_id = user.id;

        await db.execute(
            'UPDATE pppoe_clients SET installation_fee = 0, end_date = ? WHERE id = ?',
            [formattedNewEndDate, client_id]
        );
        console.log(`✅ Updated pppoe_clients table for client_id: ${client_id}`);

        // Update payment record
        await db.execute(
            'UPDATE pppoe_payments SET company_id = ?, customer_id = ?, router_id = ?, usedStatus = ?, plan_id = ? WHERE id = ?',
            [user.company_id, client_id, user.router_id, "used", user.plan_id, payment.id]
        );
        console.log(`✅ Updated pppoe_payments table for payment ID: ${payment.id}`);

        console.log("Now enabling client on mikrotik.")

        // Enable Client on Mikrotik Here

        try {
            // Transfer Funds to Recipient Company Here
            console.log("Forwarding payment to Recipient Company if required...");

            currentCompanyId = user.company_id;

            const companyDetailsResult = await checkCompanyPaymentDetails(currentCompanyId);

            // Here, only pppoe payments are being forwarded
            if (companyDetailsResult.success) {
              const { paybill_no, account_no } = companyDetailsResult.data;
              console.log("Forwarding payment to company:", paybill_no, account_no, amountPaid);
              forwardPayments(paybill_no, account_no, amountPaid)
            }
            /* */

            const enableClientResponse = await fetch("http://localhost:3001/api/enable-client", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${req.headers.authorization}` // Assuming auth token is needed
                },
                body: JSON.stringify({ client_id: client_id })
            });
        
            const enableClientData = await enableClientResponse.json();
        
            if (!enableClientResponse.ok) {
                console.error("Failed to enable client:", enableClientData);
                return res.status(enableClientResponse.status).json({
                    message: "Client updated, but enabling client failed.",
                    error: enableClientData
                });
            }
        
            console.log("Client Update Successful:", enableClientData);

            // Send SMS to the customer
            const smsResponse = await sendSmsViaAfricastalking({
                message: `Hello, your Fibre Internet subscription has been extended, it will now expire on ${formattedNewEndDate}.`,
                phone: user.phone_number,
                companyId: user.company_id
            });

            console.log("Response from Africas Talking: ", smsResponse);

        } catch (error) {
            console.error("Error enabling client:", error);
            return res.status(500).json({
                message: "Client updated, but an error occurred while enabling client on Mikrotik.",
                error: error.message
            });
        }

    } else {
        // console.log('❌ Payment is less than the required plan fee.');
        return res.status(400).json({
            success: false,
            message: '❌ Payment is less than the required plan fee. Kindly contact customer support for advice.'
        });
    }

  } catch (error) {
    // console.error('❌ M-Pesa transaction status error:', error.message);
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

// Daraja sends a callback when one does a transaction status query
router.post('/callback', async (req, res) => {
  // Check to ensure only Safaricom can make the api call to the callback url
  const clientIP = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');

  if (!allowedIPs.includes(clientIP)) {
    console.log(`❌ Unauthorized IP: ${clientIP}`);
    return res.status(403).end(); // Silent denial
  }

  try {
    const result = req.body.Result;

    console.log("Received Callback Result from Transaction Status Check: ", result);

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
        `INSERT INTO pppoe_payments (Amount, Phone, phone_number, MpesaReceiptNumber, timestamp) VALUES (?, ?, ?, ?, ?)`,
        [amount, phone, phone, receipt, completedAt]
    );


    // Step 6: Final response
    res.status(200).json({ message: 'Transaction processed successfully.' });

  } catch (error) {
    console.error('❌ Error handling transaction callback:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
