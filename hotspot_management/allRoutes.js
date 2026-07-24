const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../dbPromise');
const { verifyToken } = require('../systemFunctions');

const upload = multer({ storage: multer.memoryStorage() });

const PAYMENT_TYPES = ['power_tokens', 'amount', 'free_voucher', 'free_wifi'];

function requireHotspotAccess(req, res) {
  if (req.userType !== 'superadmin' && req.userType !== 'manager') {
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
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;
  const {
    site_name, phone_number, location, region_id,
    agreement_type, agreement_value, agreement_notes,
    status, houses
  } = req.body;

  if (!site_name || !phone_number) {
    return res.status(400).json({ error: 'site_name and phone_number are required' });
  }

  try {
    const [result] = await db.execute(
      `INSERT INTO hotspot_sites
        (company_id, site_name, phone_number, location, region_id, agreement_type, agreement_value, agreement_notes, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, site_name, phone_number, location ?? null, region_id ?? null, agreement_type ?? null, agreement_value ?? null, agreement_notes ?? null, status || 'pending', req.userId]
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
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;
  const currentMonth = firstOfMonth(new Date());

  try {
    const [sites] = await db.execute(
      `SELECT s.*, r.name AS region_name,
        (SELECT COUNT(*) FROM hotspot_site_houses h WHERE h.site_id = s.id) AS houses_count,
        (SELECT COUNT(*) FROM hotspot_site_transactions t WHERE t.site_id = s.id AND t.for_month = ?) AS settled_this_month
       FROM hotspot_sites s
       LEFT JOIN hotspot_regions r ON r.id = s.region_id
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
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;

  try {
    const [rows] = await db.execute(
      `SELECT s.*, r.name AS region_name
       FROM hotspot_sites s
       LEFT JOIN hotspot_regions r ON r.id = s.region_id
       WHERE s.id = ? AND s.company_id = ?`,
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
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;

  try {
    const [existing] = await db.execute(
      'SELECT * FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Site not found' });

    const current = existing[0];
    const {
      site_name, phone_number, location, region_id,
      agreement_type, agreement_value, agreement_notes, status
    } = req.body;

    const updated = {
      site_name: site_name ?? current.site_name,
      phone_number: phone_number ?? current.phone_number,
      location: location ?? current.location,
      region_id: region_id ?? current.region_id,
      agreement_type: agreement_type ?? current.agreement_type,
      agreement_value: agreement_value ?? current.agreement_value,
      agreement_notes: agreement_notes ?? current.agreement_notes,
      status: status ?? current.status,
    };

    await db.execute(
      `UPDATE hotspot_sites
       SET site_name = ?, phone_number = ?, location = ?, region_id = ?, agreement_type = ?, agreement_value = ?, agreement_notes = ?, status = ?
       WHERE id = ? AND company_id = ?`,
      [updated.site_name, updated.phone_number, updated.location, updated.region_id, updated.agreement_type, updated.agreement_value, updated.agreement_notes, updated.status, req.params.id, companyId]
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
  if (!requireHotspotAccess(req, res)) return;

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
  if (!requireHotspotAccess(req, res)) return;

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
  if (!requireHotspotAccess(req, res)) return;

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
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;
  const { amount, payment_type, for_month, paid_on, meter_reading, notes } = req.body;

  if (!amount || !for_month || !paid_on) {
    return res.status(400).json({ error: 'amount, for_month and paid_on are required' });
  }

  if (!payment_type || !PAYMENT_TYPES.includes(payment_type)) {
    return res.status(400).json({ error: 'payment_type must be one of: power_tokens, amount, free_voucher' });
  }

  try {
    const [site] = await db.execute(
      'SELECT id FROM hotspot_sites WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (site.length === 0) return res.status(404).json({ error: 'Site not found' });

    const [result] = await db.execute(
      'INSERT INTO hotspot_site_transactions (site_id, amount, payment_type, for_month, paid_on, meter_reading, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, amount, payment_type, firstOfMonth(for_month), paid_on, meter_reading ?? null, notes ?? null, req.userId]
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
  if (!requireHotspotAccess(req, res)) return;

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

// ==============================
// IMPORT sites from an Excel/CSV file (Site Name, Owner Number, Status columns)
// ==============================
router.post('/hotspot-management/sites/import', verifyToken, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error(err);
      return res.status(400).json({ error: 'Could not process the uploaded file. Please re-select the file and try again.' });
    }
    next();
  });
}, async (req, res) => {
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: 'Could not parse the uploaded file' });
  }

  const findValue = (row, targetName) => {
    const key = Object.keys(row).find((k) => k.trim().toLowerCase() === targetName);
    return key ? row[key] : null;
  };

  let imported = 0;
  let updated = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // account for header row

    const site_name = findValue(row, 'site name');
    const phone_number = findValue(row, 'owner number');
    const status = findValue(row, 'status');

    if (!site_name || !phone_number) {
      errors.push({ row: rowNumber, reason: 'Missing Site Name or Owner Number' });
      continue;
    }

    try {
      const [result] = await db.execute(
        `INSERT INTO hotspot_sites (company_id, site_name, phone_number, status, agreement_type, location, created_by)
         VALUES (?, ?, ?, ?, NULL, NULL, ?)
         ON DUPLICATE KEY UPDATE phone_number = VALUES(phone_number), status = VALUES(status)`,
        [companyId, String(site_name).trim(), String(phone_number).trim(), status ? String(status).trim() : 'pending', req.userId]
      );

      // MySQL reports affectedRows as 1 for a plain insert; for an upsert that matched an
      // existing row it reports 2 if a value actually changed, or 0 if the row was already identical
      if (result.affectedRows === 1) {
        imported += 1;
      } else {
        updated += 1;
      }
    } catch (err) {
      console.error(err);
      errors.push({ row: rowNumber, reason: 'Database error saving this row' });
    }
  }

  res.status(200).json({ message: 'Import complete', imported, updated, errors });
});

// ==============================
// CREATE a region
// ==============================
router.post('/hotspot-management/regions', verifyToken, async (req, res) => {
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO hotspot_regions (company_id, name, created_by) VALUES (?, ?, ?)',
      [companyId, name.trim(), req.userId]
    );
    res.status(201).json({ message: 'Region created successfully', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A region with that name already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error creating region' });
  }
});

// ==============================
// READ - list regions for the company, with site_count
// ==============================
router.get('/hotspot-management/regions', verifyToken, async (req, res) => {
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;

  try {
    const [regions] = await db.execute(
      `SELECT r.*, (SELECT COUNT(*) FROM hotspot_sites s WHERE s.region_id = r.id) AS site_count
       FROM hotspot_regions r
       WHERE r.company_id = ?
       ORDER BY r.name ASC`,
      [companyId]
    );

    res.json(regions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching regions' });
  }
});

// ==============================
// READ - single region detail with its sites[]
// ==============================
router.get('/hotspot-management/regions/:id', verifyToken, async (req, res) => {
  if (!requireHotspotAccess(req, res)) return;

  const companyId = req.company_id;

  try {
    const [rows] = await db.execute(
      'SELECT * FROM hotspot_regions WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Region not found' });

    const [sites] = await db.execute(
      `SELECT s.*,
        (SELECT COUNT(*) FROM hotspot_site_houses h WHERE h.site_id = s.id) AS houses_count
       FROM hotspot_sites s
       WHERE s.region_id = ? AND s.company_id = ?
       ORDER BY s.site_name ASC`,
      [req.params.id, companyId]
    );

    res.json({ ...rows[0], sites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching region' });
  }
});

module.exports = router;
