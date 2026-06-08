const express = require('express');
const db = require('./dbPromise');
const moment = require('moment-timezone');
const { verifyToken } = require('./systemFunctions');

const router = express.Router();

const redisClient = require("./services/redis");

// ===============================
// Helper Functions
// ===============================
const generateRandomNumber = () => Math.floor(1000 + Math.random() * 9000);

const generateUniqueUsername = async (company_name, maxRetries = 10) => {
  const baseUsername = `@${company_name.toLowerCase().replace(/\s+/g, '')}`;
  let username = baseUsername;
  let attempts = 0;

  while (attempts < maxRetries) {
    const [result] = await db.execute('SELECT COUNT(*) AS count FROM companies WHERE username = ?', [username]);
    if (result[0].count === 0) return username;
    username = `${baseUsername}${generateRandomNumber()}`;
    attempts++;
  }

  throw new Error('Unable to generate unique username after maximum retries');
};

// ===============================
// Company Subscription Usage Summary
// ===============================
router.get('/companies/subscription-usage', verifyToken, async (req, res) => {
  try {
    async function getCompanyUsage() {
      const data = await redisClient.get("company_usage_summary");
      return data ? JSON.parse(data) : [];
    }

    const usageData = await getCompanyUsage();

    if (usageData.length === 0) {
      return res.status(404).json({ message: "No company usage data found in cache" });
    }

    res.json({
      success: true,
      total_companies: usageData.length,
      data: usageData
    });
  } catch (err) {
    console.error("❌ Error fetching company subscription usage:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ===============================
// Company Subscription Usage Summary
// ===============================
router.get('/companies/subscription', verifyToken, async (req, res) => {
  const company_id = req.companyId;

  try {
    // ✅ 1. Get cached subscription data
    const cachedData = await redisClient.get("company_usage_summary");
    if (!cachedData) {
      return res.status(500).json({
        success: false,
        message: "Subscription data unavailable. Try again shortly."
      });
    }

    // ✅ 2. Parse and find company
    const companies = JSON.parse(cachedData);
    const company = companies.find(c => c.id === company_id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found in subscription data."
      });
    }

    // ✅ 3. Return whether company is active
    return res.json({
      success: true,
      company_id,
      active: !!company.active
    });

  } catch (err) {
    console.error("❌ Error fetching company subscription status:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ===============================
// CREATE a new company (POST)
// ===============================
router.post('/companies', verifyToken, async (req, res) => {
  const {
    company_name,
    address,
    phone_number,
    logo,
    allowed_users = 0,
    company_plan_name = 'Hotspot Plus PPPoE',
    expiry_date // may be optionally provided
  } = req.body;

  try {
    const username = await generateUniqueUsername(company_name);

    // get plan id
    const [planRows] = await db.execute(
      'SELECT id FROM company_plans WHERE plan_name = ? LIMIT 1',
      [company_plan_name]
    );
    if (planRows.length === 0)
      return res.status(400).json({ message: 'Invalid company plan name provided' });

    const company_plan_id = planRows[0].id;

    // compute expiry date if not provided
    const expiryDate = expiry_date
      ? moment.tz(expiry_date, 'Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss')
      : moment.tz('Africa/Nairobi').add(1, 'month').format('YYYY-MM-DD HH:mm:ss');

    const [result] = await db.execute(
      `INSERT INTO companies (
        company_name,
        address,
        phone_number,
        logo,
        username,
        allowed_users,
        company_plan_name,
        company_plan_id,
        expiry_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_name,
        address,
        phone_number,
        logo,
        username,
        allowed_users,
        company_plan_name,
        company_plan_id,
        expiryDate
      ]
    );

    res.status(201).json({
      message: 'Company created successfully',
      companyId: result.insertId,
      username,
      plan: company_plan_name,
      allowed_users,
      expiry_date: expiryDate
    });
  } catch (err) {
    console.error('Error creating company:', err);
    res.status(500).json({ message: 'Error creating company', error: err.message });
  }
});

// ===============================
// GET all companies
// ===============================
router.get('/companies', verifyToken, async (req, res) => {
  try {
    const [result] =
      req.userType === 'superadmin'
        ? await db.execute('SELECT * FROM companies')
        : await db.execute('SELECT * FROM companies WHERE id = ?', [req.company_id]);

    if (result.length === 0)
      return res.status(404).json({ message: 'Company not found' });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Database query error', error: err.message });
  }
});

// ===============================
// GET single company by ID
// ===============================
router.get('/companies/:id', verifyToken, async (req, res) => {
  const companyId = parseInt(req.params.id);
  const { userType, companyId: userCompanyId } = req;

  try {
    // ✅ Superadmin can view any company, admin only their own
    if (userType !== 'superadmin' && companyId !== userCompanyId) {
      return res.status(403).json({ message: 'Access denied: You can only view your own company' });
    }

    const [result] = await db.execute('SELECT * FROM companies WHERE id = ?', [companyId]);

    if (result.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(result[0]);
  } catch (err) {
    console.error("Database query error:", err);
    res.status(500).json({ message: 'Database query error', error: err.message });
  }
});

// ===============================
// UPDATE company (PATCH)
// ===============================
router.patch('/companies/:id', verifyToken, async (req, res) => {
  const companyId = req.params.id;
  const {
    address,
    phone_number,
    logo,
    paybill_no,
    account_no,
    forward_payment,
    allowed_users,
    expiry_date
  } = req.body;

  try {
    if (req.userType !== 'superadmin' && req.company_id !== parseInt(companyId)) {
      return res.status(403).json({ message: 'Access denied: You can only update your own company' });
    }

    const updates = [];
    const values = [];

    if (address !== undefined) { updates.push('address = ?'); values.push(address); }
    if (phone_number !== undefined) { updates.push('phone_number = ?'); values.push(phone_number); }
    if (logo !== undefined) { updates.push('logo = ?'); values.push(logo); }
    if (paybill_no !== undefined) { updates.push('paybill_no = ?'); values.push(paybill_no); }
    if (account_no !== undefined) { updates.push('account_no = ?'); values.push(account_no); }
    if (forward_payment !== undefined) { updates.push('forward_payment = ?'); values.push(forward_payment); }
    if (allowed_users !== undefined) { updates.push('allowed_users = ?'); values.push(allowed_users); }

    // ✅ allow updating expiry date
    if (expiry_date !== undefined) {
      const expiryDateFormatted = moment.tz(expiry_date, 'Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
      updates.push('expiry_date = ?');
      values.push(expiryDateFormatted);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    if (forward_payment === 1 && (!paybill_no || !account_no)) {
      return res.status(400).json({ message: 'Paybill number and Account number are required when Forward Payment is selected' });
    }

    values.push(companyId);
    const query = `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`;
    const [result] = await db.execute(query, values);

    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Company not found' });

    res.json({ message: 'Company updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Database query error', error: err.message });
  }
});

// ===============================
// DELETE company (DELETE)
// ===============================
router.delete('/companies/:id', verifyToken, async (req, res) => {
  const companyId = req.params.id;

  try {
    if (req.userType !== 'superadmin' && req.company_id !== parseInt(companyId)) {
      return res.status(403).json({ message: 'Access denied: You can only delete your own company' });
    }

    const [result] = await db.execute('DELETE FROM companies WHERE id = ?', [companyId]);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: 'Company not found' });

    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Database query error', error: err.message });
  }
});

// ===============================
// Redeem Bulk SMS Transaction
// ===============================
router.post('/companies/redeem-sms-transaction', verifyToken, async (req, res) => {
  const { trans_id } = req.body;

  if (!trans_id) {
    return res.status(400).json({ message: "Missing transaction ID" });
  }

  try {
    // 1️⃣ Check if transaction exists in all_mpesa_transactions
    const [mpesaRows] = await db.query(
      "SELECT * FROM all_mpesa_transactions WHERE trans_id = ?",
      [trans_id]
    );

    if (mpesaRows.length === 0) {
      return res.status(404).json({ message: "Transaction not found in MPESA records" });
    }

    const mpesaTx = mpesaRows[0];

    // 2️⃣ Check if transaction already redeemed
    const [existing] = await db.query(
      "SELECT * FROM bulk_sms_transactions WHERE trans_id = ?",
      [trans_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: "This transaction has already been used" });
    }

    // 3️⃣ Validate bill_ref_number pattern (BSMxx)
    const ref = mpesaTx.bill_ref_number.trim();
    const match = ref.match(/^bsm(\d+)$/i);

    if (!match) {
      return res.status(400).json({ message: "Invalid bill reference — not a Bulk SMS reference" });
    }

    const companyId = parseInt(match[1]);
    const smsUnits = parseFloat(mpesaTx.amount); // 1 KES = 1 SMS

    // 4️⃣ Update company balance in a transaction
    await db.beginTransaction();

    // Increment bulk_sms_balance
    await db.query(
      "UPDATE companies SET bulk_sms_balance = bulk_sms_balance + ? WHERE id = ?",
      [smsUnits, companyId]
    );

    // Fetch updated balance
    const [updatedCompany] = await db.query(
      "SELECT bulk_sms_balance FROM companies WHERE id = ?",
      [companyId]
    );

    const newBalance = updatedCompany[0]?.bulk_sms_balance || 0;

    // Record redemption in bulk_sms_transactions
    await db.query(
      `INSERT INTO bulk_sms_transactions (company_id, amount, bill_ref_number, trans_id)
       VALUES (?, ?, ?, ?)`,
      [companyId, smsUnits, mpesaTx.bill_ref_number, trans_id]
    );

    await db.commit();

    res.status(200).json({
      message: `Successfully redeemed ${smsUnits} SMS credits for company ${companyId}`,
      new_balance: newBalance,
      added_units: smsUnits,
    });

  } catch (err) {
    console.error("Redeem error:", err);
    await db.rollback();
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

module.exports = router;
