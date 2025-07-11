const express = require('express');
const router = express.Router();
const db = require('../dbPromise');

const { initiateSTKPush, confirmPaymentByTransactionCode, findPaymentByCheckoutRequestID, getAccessToken, initiateDarajaStkPush } = require('./mpesaFunctions');

// Endpoint to get the access token
router.get('/get-access-token', async (req, res) => {
    const token = await getAccessToken();

    if (token) {
        res.json({ access_token: token });
    } else {
        res.status(500).json({ error: 'Failed to retrieve access token' });
    }
});

// ✅ POST - Initiate Direct STK Push Via Daraja
router.post('/daraja-stk', async (req, res) => {
    const { phone_number } = req.body;

    if (!phone_number) {
        return res.status(400).json({ error: 'Missing Phone Number' });
    }

    const result = await initiateDarajaStkPush(phone_number);

    if (result) {
      // Wait two seconds for Callback & Hotspot Payments Tables to be populated
      const CheckoutRequestID = result.CheckoutRequestID
        res.json(result);
    } else {
        res.status(500).json({ error: 'STK Push failed' });
    }
});

// ✅ POST - Receive and process the callback response
router.post('/daraja-callback', async (req, res) => {
  try {
    const stkCallback = req.body?.Body?.stkCallback;

    if (!stkCallback) {
      console.error("Invalid callback structure");
      return res.status(400).json({ error: "Invalid callback structure" });
    }

    const checkoutRequestID = stkCallback.CheckoutRequestID;
    console.log("CheckoutRequestID:", checkoutRequestID);

    const items = stkCallback.CallbackMetadata?.Item;

    // Extract values
    let amount, receipt, date, phone;

    if (Array.isArray(items)) {
      items.forEach(item => {
        if (item.Name === 'Amount') amount = item.Value;
        else if (item.Name === 'MpesaReceiptNumber') receipt = item.Value;
        else if (item.Name === 'TransactionDate') date = item.Value;
        else if (item.Name === 'PhoneNumber') phone = item.Value;

        console.log(`${item.Name}: ${item.Value}`);
      });
    } else {
      console.log("No CallbackMetadata.Items found or not an array.");
    }

    // Format date if needed (optional)
    const formattedDate = moment(date, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

    // Insert into the `payments` table
    const query = `
      INSERT INTO payments (transaction_code, phone_number, amount, transaction_date, checkout_request_id)
      VALUES (?, ?, ?, ?, ?)
    `;

    await db.execute(query, [receipt, phone, amount, formattedDate, checkoutRequestID]);

    console.log("Payment inserted into DB successfully.");

    res.status(200).json({ message: "Callback received and stored successfully" });
  } catch (error) {
    console.error("Error processing callback:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// This should initiate mpesa, save req, check payment, create voucher, 
// enable user, return username & password, create user ifnotexist
router.post('/stk-push', async (req, res) => {
  const { phone_number, company_id, plan_id } = req.body;
  const result = await initiateSTKPush(phone_number, company_id, plan_id);
  return res.status(result.success ? 200 : 400).json(result);
});

router.post('/reconnect', async (req, res) => {
  const { transaction_code, router_id } = req.body;

  const result = await confirmPaymentByTransactionCode(transaction_code, router_id);

  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

router.post('/find-payment', async (req, res) => {
  const { checkoutRequestID } = req.body;
  // console.log("From Internal Request: ", checkoutRequestID);

  const result = await findPaymentByCheckoutRequestID(checkoutRequestID);

  if (result.success) {
    return res.status(200).json(result);
  } else {
    return res.status(404).json(result);
  }
});


module.exports = router;