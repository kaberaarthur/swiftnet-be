const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');

// Middleware
function verifyToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  const bearerToken = token.split(' ')[1];
  jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(500).json({ message: 'Failed to authenticate token' });

    req.userId = decoded.id;
    req.userType = decoded.user_type;
    req.company_id = decoded.company_id;
    next();
  });
}

router.get('/daily-transactions', verifyToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
    } = req.query;

    const company_id = req.company_id; // Get company_id from the verified token

    // Ensure limit and page are valid integers
    const parsedLimit = parseInt(limit, 10) || 10; // Fallback to 10 if invalid
    const parsedPage = parseInt(page, 10) || 1;   // Fallback to 1 if invalid
    const offset = (parsedPage - 1) * parsedLimit;

    // Get the start and end of the current day in UTC+3 (East Africa Time)
    const timezone = 'Africa/Nairobi'; // This timezone is UTC+3
    const startOfDay = moment().tz(timezone).startOf('day').format('YYYY-MM-DD HH:mm:ss');
    const endOfDay = moment().tz(timezone).endOf('day').format('YYYY-MM-DD HH:mm:ss');

    // Prepare the WHERE clause parameters
    const params = [company_id, startOfDay, endOfDay];

    // Build the complete query with LIMIT and OFFSET as string interpolation
    const selectQuery = `
      SELECT * FROM pppoe_payments 
      WHERE company_id = ? AND timestamp BETWEEN ? AND ? 
      ORDER BY timestamp DESC 
      LIMIT ${parsedLimit} OFFSET ${offset}
    `;

    console.log("Query:", selectQuery);
    console.log("Parameters:", params);
    console.log("Parameter types:", params.map(p => typeof p));

    // Get paginated results
    const [rows] = await db.execute(selectQuery, params);

    // Get total count and sum of Amount
    const [countAndSumResult] = await db.execute(`
      SELECT COUNT(*) as total, SUM(Amount) as total_amount 
      FROM pppoe_payments 
      WHERE company_id = ? AND timestamp BETWEEN ? AND ?
    `, params);

    const { total, total_amount } = countAndSumResult[0];
    const totalPages = Math.ceil(total / parsedLimit);

    res.status(200).json({
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages,
      total_amount: parseFloat(total_amount) || 0, // Convert to float and default to 0 if null
      data: rows,
      timeRange: {
        start: startOfDay,
        end: endOfDay
      }
    });

  } catch (error) {
    console.error('Error fetching daily transactions:', error);

    const errorDetails = {
      message: 'Server error',
      error: error.message || 'Unknown error',
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      sql: error.sql,
    };

    // Log full details for the server
    console.error('Error details:', errorDetails);

    // Respond with details (safe for dev, strip for production)
    res.status(500).json(errorDetails);
  }
});

router.get('/all-mpesa-transactions', verifyToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      trans_id,
      bill_ref_number,
      first_name,
      from,
      to,
    } = req.query;

    // Ensure limit and page are valid integers
    const parsedLimit = parseInt(limit, 10) || 20; // Fallback to 20 if invalid
    const parsedPage = parseInt(page, 10) || 1;   // Fallback to 1 if invalid
    const offset = (parsedPage - 1) * parsedLimit;

    const params = [];
    const conditions = [];

    // Filtering conditions
    if (trans_id) {
      conditions.push(`trans_id LIKE ?`);
      params.push(`%${trans_id}%`);
    }

    if (bill_ref_number) {
      conditions.push(`bill_ref_number LIKE ?`);
      params.push(`%${bill_ref_number}%`);
    }

    if (first_name) {
      conditions.push(`first_name LIKE ?`);
      params.push(`%${first_name}%`);
    }

    if (from && to) {
      conditions.push(`created_at BETWEEN ? AND ?`);
      params.push(moment(from).startOf('day').format('YYYY-MM-DD HH:mm:ss'));
      params.push(moment(to).endOf('day').format('YYYY-MM-DD HH:mm:ss'));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Prepare final parameters for both queries
    const selectParams = [...params];
    const countParams = [...params];

    // Build the complete query with LIMIT and OFFSET as string interpolation
    const selectQuery = `SELECT * FROM all_mpesa_transactions ${whereClause} ORDER BY created_at DESC LIMIT ${parsedLimit} OFFSET ${offset}`;
    
    console.log("Query:", selectQuery);
    console.log("Parameters:", selectParams);
    console.log("Parameter types:", selectParams.map(p => typeof p));

    // Get paginated results
    const [rows] = await db.execute(selectQuery, selectParams);

    // Get total count
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM all_mpesa_transactions ${whereClause}`,
      countParams
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / parsedLimit);

    res.status(200).json({
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages,
      data: rows, // Uncommented this to include data in the response
    });
  } catch (error) {
    console.error('Error fetching MPESA transactions:', error);

    const errorDetails = {
        message: 'Server error',
        error: error.message || 'Unknown error',
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        sql: error.sql,
    };

    // Log full details for the server
    console.error('Error details:', errorDetails);

    // Respond with details (safe for dev, strip for production)
    res.status(500).json(errorDetails);
    }

});

module.exports = router;
