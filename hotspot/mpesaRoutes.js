const express = require('express');
const router = express.Router();

const { initiateSTKPush } = require('./mpesaFunctions');

router.post('/stk-push', async (req, res) => {
  const { phone_number, company_id } = req.body;
  const result = await initiateSTKPush(phone_number, company_id);
  return res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;