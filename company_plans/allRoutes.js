const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const {verifyToken} = require('../systemFunctions');

// ==============================
// CREATE a new company plan
// ==============================
router.post('/', verifyToken, async (req, res) => {
  const userType = req.userType;

  if (userType!== 'superadmin') {
    return res.status(403).json({ error: 'You are not authorized to make this request' });
  }

  try {
    const { plan_name, rate } = req.body;

    if (!plan_name || !rate) {
      return res.status(400).json({ error: 'plan_name and rate are required' });
    }

    const [result] = await db.execute(
      'INSERT INTO company_plans (plan_name, rate) VALUES (?, ?)',
      [plan_name, rate]
    );

    res.status(201).json({ message: 'Plan created successfully', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error creating plan' });
  }
});

// ==============================
// READ - Get all company plans
// ==============================
router.get('/', verifyToken, async (req, res) => {
  try {
    const [plans] = await db.execute('SELECT * FROM company_plans ORDER BY id ASC');
    res.json(plans);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching plans' });
  }
});

// ==============================
// READ - Get a single plan by ID
// ==============================
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM company_plans WHERE id = ?', [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Plan not found' });

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching plan' });
  }
});

// ==============================
// UPDATE (PATCH) - Update a plan
// ==============================
router.patch('/:id', async (req, res) => {
  const userType = req.userType;

  if (userType!== 'superadmin') {
    return res.status(403).json({ error: 'You are not authorized to make this request' });
  }

  try {
    const { plan_name, rate } = req.body;

    const [existing] = await db.execute('SELECT * FROM company_plans WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Plan not found' });

    const updatedPlan = {
      plan_name: plan_name ?? existing[0].plan_name,
      rate: rate ?? existing[0].rate
    };

    await db.execute(
      'UPDATE company_plans SET plan_name = ?, rate = ? WHERE id = ?',
      [updatedPlan.plan_name, updatedPlan.rate, req.params.id]
    );

    res.json({ message: 'Plan updated successfully', updatedPlan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error updating plan' });
  }
});

// ==============================
// DELETE a plan
// ==============================
router.delete('/:id', async (req, res) => {
  const userType = req.userType;

  if (userType!== 'superadmin') {
    return res.status(403).json({ error: 'You are not authorized to make this request' });
  }

  try {
    const [result] = await db.execute('DELETE FROM company_plans WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json({ message: 'Plan deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error deleting plan' });
  }
});

module.exports = router;
