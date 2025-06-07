const express = require('express');
const router = express.Router();

const { initiateSTKPush, confirmPaymentByTransactionCode, findPaymentByCheckoutRequestID } = require('./mpesaFunctions');

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