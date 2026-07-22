const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const { verifyToken } = require('../systemFunctions');

function requireSuperAdmin(req, res) {
  if (req.userType !== 'superadmin') {
    res.status(403).json({ error: 'You are not authorized to make this request' });
    return false;
  }
  return true;
}

function firstOfMonth(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ==============================
// CREATE a new site (optionally with houses[])
// ==============================
router.post('/hotspot-management/sites', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;
  const {
    site_name, phone_number, location,
    agreement_type, agreement_value, agreement_notes,
    status, houses
  } = req.body;

  if (!site_name || !phone_number || !location || !agreement_type) {
    return res.status(400).json({ error: 'site_name, phone_number, location and agreement_type are required' });
  }

  try {
    const [result] = await db.execute(
      `INSERT INTO hotspot_sites
        (company_id, site_name, phone_number, location, agreement_type, agreement_value, agreement_notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, site_name, phone_number, location, agreement_type, agreement_value ?? null, agreement_notes ?? null, status || 'pending', req.userId]
    );

    const siteId = result.insertId;

    if (Array.isArray(houses)) {
      for (const house of houses) {
        if (!house?.house_label) continue;
        await db.execute(
          'INSERT INTO hotspot_site_houses (site_id, house_label, notes) VALUES (?, ?, ?)',
          [siteId, house.house_label, house.notes ?? null]
        );
      }
    }

    res.status(201).json({ message: 'Site created successfully', id: siteId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error creating site' });
  }
});

// ==============================
// READ - list sites for the company, with houses_count + settled_this_month
// ==============================
router.get('/hotspot-management/sites', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;
  const currentMonth = firstOfMonth(new Date());

  try {
    const [sites] = await db.execute(
      `SELECT s.*,
        (SELECT COUNT(*) FROM hotspot_site_houses h WHERE h.site_id = s.id) AS houses_count,
        (SELECT COUNT(*) FROM hotspot_site_transactions t WHERE t.site_id = s.id AND t.for_month = ?) AS settled_this_month
       FROM hotspot_sites s
       WHERE s.company_id = ?
       ORDER BY s.id DESC`,
      [currentMonth, companyId]
    );

    res.json(sites);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching sites' });
  }
});

// ==============================
// READ - single site detail with houses[] and transactions[]
// ==============================
router.get('/hotspot-management/sites/:id', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;

  try {
    const [rows] = await db.execute(
      'SELECT * FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Site not found' });

    const [houses] = await db.execute(
      'SELECT * FROM hotspot_site_houses WHERE site_id = ? ORDER BY id ASC',
      [req.params.id]
    );

    const [transactions] = await db.execute(
      'SELECT * FROM hotspot_site_transactions WHERE site_id = ? ORDER BY for_month DESC',
      [req.params.id]
    );

    res.json({ ...rows[0], houses, transactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching site' });
  }
});

// ==============================
// UPDATE (PATCH) a site
// ==============================
router.patch('/hotspot-management/sites/:id', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;

  try {
    const [existing] = await db.execute(
      'SELECT * FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Site not found' });

    const current = existing[0];
    const {
      site_name, phone_number, location,
      agreement_type, agreement_value, agreement_notes, status
    } = req.body;

    const updated = {
      site_name: site_name ?? current.site_name,
      phone_number: phone_number ?? current.phone_number,
      location: location ?? current.location,
      agreement_type: agreement_type ?? current.agreement_type,
      agreement_value: agreement_value ?? current.agreement_value,
      agreement_notes: agreement_notes ?? current.agreement_notes,
      status: status ?? current.status,
    };

    await db.execute(
      `UPDATE hotspot_sites
       SET site_name = ?, phone_number = ?, location = ?, agreement_type = ?, agreement_value = ?, agreement_notes = ?, status = ?
       WHERE id = ? AND company_id = ?`,
      [updated.site_name, updated.phone_number, updated.location, updated.agreement_type, updated.agreement_value, updated.agreement_notes, updated.status, req.params.id, companyId]
    );

    res.json({ message: 'Site updated successfully', updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error updating site' });
  }
});

// ==============================
// DELETE a site
// ==============================
router.delete('/hotspot-management/sites/:id', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;

  try {
    const [existing] = await db.execute(
      'SELECT * FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Site not found' });

    const [result] = await db.execute('DELETE FROM hotspot_sites WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Site not found' });

    res.json({ message: 'Site deleted successfully' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(400).json({ error: 'Cannot delete a site that has recorded payments. Remove its transactions first.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error deleting site' });
  }
});

// ==============================
// CREATE a house under a site
// ==============================
router.post('/hotspot-management/sites/:id/houses', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;
  const { house_label, notes } = req.body;

  if (!house_label) return res.status(400).json({ error: 'house_label is required' });

  try {
    const [site] = await db.execute(
      'SELECT id FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (site.length === 0) return res.status(404).json({ error: 'Site not found' });

    const [result] = await db.execute(
      'INSERT INTO hotspot_site_houses (site_id, house_label, notes) VALUES (?, ?, ?)',
      [req.params.id, house_label, notes ?? null]
    );

    res.status(201).json({ message: 'House added successfully', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error adding house' });
  }
});

// ==============================
// DELETE a house
// ==============================
router.delete('/hotspot-management/houses/:id', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;

  try {
    const [rows] = await db.execute(
      `SELECT h.id FROM hotspot_site_houses h
       JOIN hotspot_sites s ON s.id = h.site_id
       WHERE h.id = ? AND s.company_id = ?`,
      [req.params.id, companyId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'House not found' });

    await db.execute('DELETE FROM hotspot_site_houses WHERE id = ?', [req.params.id]);

    res.json({ message: 'House removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error removing house' });
  }
});

// ==============================
// CREATE a transaction (record a monthly payment) for a site
// ==============================
router.post('/hotspot-management/sites/:id/transactions', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;
  const { amount, for_month, paid_on, notes } = req.body;

  if (!amount || !for_month || !paid_on) {
    return res.status(400).json({ error: 'amount, for_month and paid_on are required' });
  }

  try {
    const [site] = await db.execute(
      'SELECT id FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (site.length === 0) return res.status(404).json({ error: 'Site not found' });

    const [result] = await db.execute(
      'INSERT INTO hotspot_site_transactions (site_id, amount, for_month, paid_on, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, amount, firstOfMonth(for_month), paid_on, notes ?? null, req.userId]
    );

    res.status(201).json({ message: 'Payment recorded successfully', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A payment for that month has already been recorded for this site' });
    }
    console.error(err);
    res.status(500).json({ error: 'Error recording payment' });
  }
});

// ==============================
// DELETE a transaction
// ==============================
router.delete('/hotspot-management/transactions/:id', verifyToken, async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;

  const companyId = req.company_id;

  try {
    const [rows] = await db.execute(
      `SELECT t.id FROM hotspot_site_transactions t
       JOIN hotspot_sites s ON s.id = t.site_id
       WHERE t.id = ? AND s.company_id = ?`,
      [req.params.id, companyId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    await db.execute('DELETE FROM hotspot_site_transactions WHERE id = ?', [req.params.id]);

    res.json({ message: 'Transaction removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error removing transaction' });
  }
});

module.exports = router;
