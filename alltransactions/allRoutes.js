const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const jwt = require('jsonwebtoken');
const moment = require('moment');

// Middleware
function verifyToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: 'No token provided' });

  const bearerToken = token.split(' ')[1];
  jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
    if (err) return res.status(500).json({ message: 'Failed to authenticate token' });

    req.userId = decoded.id;
    req.userType = decoded.user_type;
    next();
  });
}

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
