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

module.exports = router;