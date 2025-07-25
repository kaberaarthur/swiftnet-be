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
  sendSmsViaAfricastalking
} = require('./functions');

router.get('/hello', (req, res) => {
  res.json({ message: 'Hello from Node.js!' });
});

// POST endpoint to send BusinessPayBill request
router.post('/b2b-payment', async (req, res) => {
    const { company_id, paybill_no, account_no, amount } = req.body;
    const password = await getDarajaInitiatorPassword(company_id);

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
  '196.201.212.69'
];

// Helper to normalize IPs (removes ::ffff: if present)
function normalizeIp(ip) {
  return ip.replace('::ffff:', '');
}

router.post('/b2b-result', async (req, res) => {
  // IP validation
  const rawIp =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const clientIp = normalizeIp(rawIp);

  if (!allowedIps.includes(clientIp)) {
    console.warn(`Rejected B2B callback from disallowed IP: ${clientIp}`);
    return res.status(403).json({ message: 'Forbidden: IP not allowed' });
  }

  try {
    const result = req.body.Result;

    if (!result) {
      return res.status(400).json({ message: 'Invalid payload' });
    }

    const {
      OriginatorConversationID,
      ConversationID,
      TransactionID,
      ResultCode,
      ResultDesc,
      ResultParameters,
      ReferenceData
    } = result;

    const status = parseInt(ResultCode) === 0 ? 'success' : 'failed';

    // Parse Result Parameters
    const resultParams = Array.isArray(ResultParameters?.ResultParameter)
      ? ResultParameters.ResultParameter
      : ResultParameters?.ResultParameter
      ? [ResultParameters.ResultParameter]
      : [];

    const paramsMap = {};
    for (const param of resultParams) {
      paramsMap[param.Key] = param.Value;
    }

    // Parse Reference Items
    const refItems = Array.isArray(ReferenceData?.ReferenceItem)
      ? ReferenceData.ReferenceItem
      : ReferenceData?.ReferenceItem
      ? [ReferenceData.ReferenceItem]
      : [];

    const refMap = {};
    for (const item of refItems) {
      refMap[item.Key] = item.Value;
    }

    // Insert into DB
    const sql = `
      INSERT INTO pppoe_b2b_payments (
        originator_conversation_id,
        conversation_id,
        transaction_id,
        result_code,
        result_desc,
        amount,
        currency,
        status,
        bill_reference_number,
        trans_completed_time,
        debit_account_balance,
        debit_party_account_balance,
        debit_party_charges,
        receiver_party_public_name,
        initiator_account_balance,
        reference_data,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      OriginatorConversationID || null,
      ConversationID || null,
      TransactionID || null,
      ResultCode || null,
      ResultDesc || null,
      paramsMap['Amount'] || null,
      paramsMap['Currency'] || null,
      status,
      refMap['BillReferenceNumber'] || null,
      paramsMap['TransCompletedTime'] || null,
      paramsMap['DebitAccountBalance'] || null,
      paramsMap['DebitPartyAffectedAccountBalance'] || null,
      paramsMap['DebitPartyCharges'] || null,
      paramsMap['ReceiverPartyPublicName'] || null,
      paramsMap['InitiatorAccountCurrentBalance'] || null,
      JSON.stringify(refMap),
      JSON.stringify(req.body)
    ];

    await db.execute(sql, values);

    res.status(200).json({ message: 'B2B result processed successfully' });
  } catch (err) {
    console.error('Error saving B2B result:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;