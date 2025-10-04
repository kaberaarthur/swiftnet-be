const express = require('express');
const router = express.Router();
const db = require('./dbPromise');

const verifyToken = require('./systemFunctions').verifyToken;

// Endpoint to get total users
router.get('/total-users', verifyToken, async (req, res) => {
  try {
    const company_id = req.companyId;

    // Get total hotspot clients
    const [hotspotRows] = await db.execute(
      'SELECT COUNT(*) as total FROM hotspot_clients WHERE company_id = ?',
      [company_id]
    );

    // Get total pppoe clients
    const [pppoeRows] = await db.execute(
      'SELECT COUNT(*) as total FROM pppoe_clients WHERE company_id = ?',
      [company_id]
    );

    res.json({
      hotspot_total: hotspotRows[0].total,
      pppoe_total: pppoeRows[0].total,
      combined_total: hotspotRows[0].total + pppoeRows[0].total
    });
  } catch (err) {
    console.error('Error fetching total users:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint to get PPPoE payments totals
router.get('/pppoe-payments-total', verifyToken, async (req, res) => {
  try {
    const company_id = req.companyId;
    const user_type = req.userType;

    // ✅ Restrict access: only "admin" or "superadmin" can fetch DB totals
    if (user_type !== "admin" && user_type !== "superadmin") {
      return res.json({
        total_today: "0.00",
        total_month: "0.00",
      });
    }

    // Get today's total
    const [todayRows] = await db.execute(
      `SELECT IFNULL(SUM(Amount), 0) as total_today 
       FROM pppoe_payments 
       WHERE company_id = ? 
       AND DATE(created_at) = CURDATE()`,
      [company_id]
    );

    // Get this month's total
    const [monthRows] = await db.execute(
      `SELECT IFNULL(SUM(Amount), 0) as total_month 
       FROM pppoe_payments 
       WHERE company_id = ? 
       AND YEAR(created_at) = YEAR(CURDATE()) 
       AND MONTH(created_at) = MONTH(CURDATE())`,
      [company_id]
    );

    res.json({
      total_today: todayRows[0].total_today,
      total_month: monthRows[0].total_month,
    });
  } catch (err) {
    console.error("Error fetching PPPoE payments total:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;