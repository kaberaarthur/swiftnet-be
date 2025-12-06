const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const moment = require('moment');


const { initiateSTKPush, confirmPaymentByTransactionCode, findPaymentByCheckoutRequestID, getAccessToken, initiateDarajaStkPush } = require('./mpesaFunctions');
const { deleteOldRedeemedVouchers, createVoucher, generatePassword, handleHotspotClient, getPlanDetails, finalizePaymentById, finalizeVoucherCodeById } = require('./actionFunctions');
const { createOrResetMikrotikHotspotUser, getRouterDetails } = require('./mikrotikFunctions');

// Import Forward Payment Function
const { checkCompanyPaymentDetails, forwardPayments } = require('../transaction_status/functions');

// Endpoint to get the access token
router.get('/get-access-token', async (req, res) => {
    const token = await getAccessToken();

    if (token) {
        res.json({ access_token: token });
    } else {
        res.status(500).json({ error: 'Operation has failed' });
    }
});

router.post('/test-mikrotik', async (req, res) => {
    // Create or Reset MikroTik Hotspot User
    const mikrotikResult = await createOrResetMikrotikHotspotUser(
      "104.248.76.5",
      "admin",
      "Nopa55word*",
      "254790485731",
      "On1pTz",
      "1 Hour",
      3012
    );

    if (!mikrotikResult.success) {
      console.error('Failed to create/reset MikroTik hotspot user:', mikrotikResult.message);
      return res.status(400).json({ success: false, error: mikrotikResult.message });
    }

    console.log(mikrotikResult);

    res.json(mikrotikResult);
});

// ✅ POST - Initiate Direct STK Push Via Daraja
router.post('/daraja-stk', async (req, res) => {
  const { phone_number, plan_id, router_id } = req.body;

  // Validate request body
  if (!phone_number || !plan_id || !router_id) {
    return res.status(400).json({ error: 'Missing critical details: phone_number, plan_id, or router_id is required' });
  }

  // Fetch plan details
  const thePlan = await getPlanDetails(plan_id);
  if (!thePlan) {
    console.log('Plan not found for plan_id:', plan_id);
    return res.status(400).json({ error: 'Could not trace the specified plan' });
  }

  // If Plan is Premium, Generate a Voucher Code and return it as part of the response
  if(thePlan.premium == 1){
    console.log("This is a Premium Plan, a voucher will be generated upon successful payment.");
  }

  // Initiate STK Push
  const result = await initiateDarajaStkPush(phone_number, parseInt(thePlan.plan_price));
  if (!result || !result.CheckoutRequestID) {
    console.error('STK Push failed or no CheckoutRequestID returned:', result);
    return res.status(500).json({ error: 'Failed to initiate STK Push' });
  }

  const CheckoutRequestID = result.CheckoutRequestID;

  try {
    let MpesaReceiptNumber = null;
    let bill_ref_number = null;

    for (let attempt = 1; attempt <= 30; attempt++) {
      console.log(`🔁 Attempt ${attempt} to find payment record for CheckoutRequestID: ${CheckoutRequestID}`);

      // 🔍 Query payments table
      let paymentRows;
      try {
        [paymentRows] = await db.execute(
          `SELECT id, MpesaReceiptNumber, Amount FROM payments WHERE CheckoutRequestID = ? LIMIT 1`,
          [CheckoutRequestID]
        );
      } catch (dbError) {
        console.error(`❌ Database error querying payments table (attempt ${attempt}):`, dbError);
        return res.status(500).json({
          ...result,
          error: `Database error while querying payment records: ${dbError.message}`
        });
      }

      if (!paymentRows || paymentRows.length === 0) {
        console.log(`No payment record found for CheckoutRequestID: ${CheckoutRequestID}`);
      } else {
        const paymentId = paymentRows[0].id;
        console.log("Fruher Mpesa Transaction ID: ", paymentId);
        MpesaReceiptNumber = paymentRows[0].MpesaReceiptNumber;
        console.log(`Found MpesaReceiptNumber: ${MpesaReceiptNumber}`);

        // 🔍 Query all_mpesa_transactions table
        let transactionRows;
        try {
          [transactionRows] = await db.execute(
            `SELECT bill_ref_number FROM all_mpesa_transactions WHERE trans_id = ? LIMIT 1`,
            [MpesaReceiptNumber]
          );
        } catch (dbError) {
          console.error(`❌ Database error querying all_mpesa_transactions table (attempt ${attempt}):`, dbError);
          return res.status(500).json({
            ...result,
            error: `Database error while querying transaction records: ${dbError.message}`
          });
        }

        if (!transactionRows || transactionRows.length === 0) {
          console.log(`No transaction record found for MpesaReceiptNumber: ${MpesaReceiptNumber}`);
        } else {
          bill_ref_number = transactionRows[0].bill_ref_number;
          console.log(`Found bill_ref_number: ${bill_ref_number}`);

          // Confirm if this is a Hotspot Payment
          if (bill_ref_number === "Hotspot") {
            // ✅ Found both, proceed with processing
            const thisRouterResponse = await getRouterDetails(router_id);
            if (!thisRouterResponse.success) {
              console.error('Failed to fetch router details:', thisRouterResponse.message);
              return res.status(400).json({ success: false, error: thisRouterResponse.message });
            }
            const thisRouter = thisRouterResponse.data;
            console.log('Router details:', thisRouter);

            // Payment Received, Forward to Recipient Company
            console.log("Payment is for Hotspot, proceeding with further processing...");
            const theAmount = paymentRows[0].Amount;
            const thisCompanyID = thisRouter.company_id;
                        
            const companyDetailsResult = await checkCompanyPaymentDetails(thisCompanyID);

            // Here, only Hotspot payments are being forwarded
            if (companyDetailsResult.success) {
              const { paybill_no, account_no } = companyDetailsResult.data;
              console.log("Forwarding payment to company:", paybill_no, account_no, theAmount);
              forwardPayments(paybill_no, account_no, theAmount)
            }


            // Generate a Password
            const newPassword = generatePassword();

            // Delete old Redeemed Vouchers
            try {
              await deleteOldRedeemedVouchers();
            } catch (voucherError) {
              console.error('Error deleting old redeemed vouchers:', voucherError);
              return res.status(500).json({ success: false, error: 'Failed to delete old redeemed vouchers' });
            }

            // Create Voucher
            console.log('Creating voucher for:', { plan_id, phone_number });
            const createVoucherResult = await createVoucher(plan_id, phone_number);
            if (!createVoucherResult.success) {
              console.error('Failed to create voucher:', createVoucherResult.message);
              return res.status(400).json({ success: false, error: createVoucherResult.message });
            }

            // Log input values for MikroTik Hotspot User
            console.log('Creating MikroTik Hotspot User with:', {
              IP: thisRouter.ip_address,
              RouterUsername: thisRouter.username,
              RouterPassword: thisRouter.router_secret,
              HotspotUsername: phone_number,
              HotspotPassword: newPassword,
              HotspotPlan: thePlan.plan_name
            });

            // Create or Reset MikroTik Hotspot User
            const mikrotikResult = await createOrResetMikrotikHotspotUser(
              thisRouter.ip_address,
              thisRouter.username,
              thisRouter.router_secret,
              phone_number,
              newPassword,
              thePlan.plan_name,
              thisRouter.port
            );

            if (!mikrotikResult.success) {
              console.error('Failed to create/reset MikroTik hotspot user:', mikrotikResult.message);
              return res.status(400).json({ success: false, error: mikrotikResult.message });
            }

            console.log(mikrotikResult);

            // Store/Update Hotspot Client in DB
            const handleHotspotClientResult = await handleHotspotClient(
              thisRouter.id,
              phone_number,
              newPassword,
              createVoucherResult
            );

            if (!handleHotspotClientResult.success) {
              console.error('Failed to handle hotspot client:', handleHotspotClientResult.message);
              return res.status(400).json({ success: false, error: handleHotspotClientResult.message });
            }

            // Update Vouchers & Mpesa Transaction Rows
            // This immediately marks the voucher as used
            if(thePlan.premium == 1){
              console.log("This is a Premium Plan, voucher will be finalized after first redemption.");
            } else {
              const voucher_id = createVoucherResult.voucher_id;
              finalizeVoucherCodeById(voucher_id);
            }
            

            const mpesa_transaction_id = paymentId;
            console.log("Mpesa Transaction ID: ", mpesa_transaction_id);
            finalizePaymentById(mpesa_transaction_id, phone_number, createVoucherResult);

            // ✅ Success Response
            return res.json({
              success: true,
              // ...result,
              MpesaReceiptNumber,
              // bill_ref_number,
              phone_number,
              newPassword,
              voucher: createVoucherResult.voucher_code,
            });
          }
        }
      }

      // ⏱ Wait 5 seconds before next attempt
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // ❌ Not found after 10 tries
    console.log(`Transaction not found after 10 attempts for CheckoutRequestID: ${CheckoutRequestID}`);
    return res.status(404).json({
      ...result,
      error: 'Transaction not found after waiting 50 seconds'
    });

  } catch (error) {
    console.error('❌ Error during STK follow-up logic:', error);
    return res.status(500).json({
      ...result,
      error: `Internal server error during follow-up check: ${error.message}`
    });
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

    const CheckoutRequestID = stkCallback.CheckoutRequestID;
    console.log("CheckoutRequestID:", CheckoutRequestID);

    const items = stkCallback.CallbackMetadata?.Item;

    // Extract values
    let Amount, MpesaReceiptNumber, TransactionDate, PhoneNumber;

    if (Array.isArray(items)) {
      items.forEach(item => {
        if (item.Name === 'Amount') Amount = item.Value;
        else if (item.Name === 'MpesaReceiptNumber') MpesaReceiptNumber = item.Value;
        else if (item.Name === 'TransactionDate') TransactionDate = item.Value;
        else if (item.Name === 'PhoneNumber') PhoneNumber = item.Value;

        console.log(`${item.Name}: ${item.Value}`);
      });
    }

    // Convert date format
    const formattedDate = moment(TransactionDate, 'YYYYMMDDHHmmss').format('YYYY-MM-DD HH:mm:ss');

    // Insert into DB (use same field names)
    const insertQuery = `
      INSERT INTO payments (
        Amount,
        MpesaReceiptNumber,
        timestamp,
        Phone,
        CheckoutRequestID
      ) VALUES (?, ?, ?, ?, ?)
    `;

    await db.execute(insertQuery, [
      Amount,
      MpesaReceiptNumber,
      formattedDate,
      PhoneNumber,
      CheckoutRequestID
    ]);

    console.log("Payment record inserted into database");
    res.status(200).json({ message: "Callback received and saved." });

  } catch (error) {
    console.error("Error processing STK callback:", error);
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