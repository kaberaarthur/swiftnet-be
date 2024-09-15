const express = require('express');
const pool = require('./dbPromise'); // Import the promise-compatible pool

const router = express.Router();

// Helper function to get the current date-time in GMT+3
const getCurrentDateTimeInGMTPlus3 = () => {
  // Get the current date and time in UTC
  const now = new Date();

  // Convert to GMT+3 (UTC + 3 hours)
  const gmtPlus3Offset = 3 * 60; // 3 hours in minutes
  const gmtPlus3Date = new Date(now.getTime() + gmtPlus3Offset * 60 * 1000);

  // Return ISO string format for MySQL query
  return gmtPlus3Date.toISOString().slice(0, 19).replace('T', ' ');
};

// 1. Create a Voucher (POST)
router.post('/vouchers', async (req, res) => {
  const { type, routers, plan_name, plan_duration, code_voucher, start_date, end_date, customer } = req.body;
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO vouchers (type, routers, plan_name, plan_duration, code_voucher, start_date, end_date, customer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [type, routers, plan_name, plan_duration, code_voucher, start_date, end_date, customer]
    );

    await connection.commit();
    res.status(201).json({
      message: 'Voucher created successfully',
      voucherId: result.insertId
    });
  } catch (err) {
    console.error(err);
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({ error: 'Failed to create voucher' });
  } finally {
    if (connection) connection.release();
  }
});

// 2. Get All Vouchers with Pagination (GET)
router.get('/vouchers', async (req, res) => {
  const page = parseInt(req.query.page) || 1; // Current page (default is 1)
  const limit = parseInt(req.query.limit) || 10; // Items per page (default is 10)
  const offset = (page - 1) * limit; // Offset calculation
  let connection;

  try {
    connection = await pool.getConnection();

    // Fetch vouchers with pagination
    const [vouchers] = await connection.query('SELECT * FROM vouchers LIMIT ? OFFSET ?', [limit, offset]);
    // Fetch total count for pagination
    const [totalCount] = await connection.query('SELECT COUNT(*) AS count FROM vouchers');
    const totalItems = totalCount[0].count;
    const totalPages = Math.ceil(totalItems / limit);

    res.json({
      totalItems,
      totalPages,
      currentPage: page,
      vouchers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve vouchers' });
  } finally {
    if (connection) connection.release();
  }
});

// 3. Get a Voucher by ID (GET)
router.get('/vouchers/:id', async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query('SELECT * FROM vouchers WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Voucher not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve voucher' });
  } finally {
    if (connection) connection.release();
  }
});

// 4. Delete a Voucher by ID (DELETE)
router.delete('/vouchers/:id', async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query('DELETE FROM vouchers WHERE id = ?', [id]);
    await connection.commit();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Voucher not found' });
    }

    res.json({ message: 'Voucher deleted successfully' });
  } catch (err) {
    console.error(err);
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({ error: 'Failed to delete voucher' });
  } finally {
    if (connection) connection.release();
  }
});

// 5. Delete All Records Where end_date is Older Than Current Date in GMT+3 (DELETE)
router.delete('/vouchers/delete-used', async (req, res) => {
  const currentDateTime = getCurrentDateTimeInGMTPlus3(); // Get current date-time in GMT+3
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query('DELETE FROM vouchers WHERE end_date < ?', [currentDateTime]);
    await connection.commit();

    res.json({ message: `${result.affectedRows} voucher(s) deleted successfully` });
  } catch (err) {
    console.error(err);
    if (connection) {
      await connection.rollback();
    }
    res.status(500).json({ error: 'Failed to delete old vouchers' });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
