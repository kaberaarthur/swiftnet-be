const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const jwt = require('jsonwebtoken');

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    const bearerToken = token.split(' ')[1];
    
    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.company_id = decoded.company_id;
        next();
    });
}

// GET logs with pagination
router.get('/import-pppoe-plans-logs', verifyToken, async (req, res) => {
    const company_id = req.company_id; // from token
    if (!company_id) {
        return res.status(400).json({ error: 'company_id is required' });
    }
    
    try {
        const DEFAULT_PAGE = 1;
        const DEFAULT_LIMIT = 10;

        const page = parseInt(req.query.page, 10) || DEFAULT_PAGE;
        const limit = parseInt(req.query.limit, 10) || DEFAULT_LIMIT;

        if (page < 1) {
            return res.status(400).json({ error: 'Invalid page number' });
        }
        if (limit < 1) {
            return res.status(400).json({ error: 'Invalid limit value' });
        }

        const offset = (page - 1) * limit;

        // Get total count with company_id filter
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total 
             FROM import_pppoe_plans_logs
             WHERE company_id = ?`,
            [company_id]
        );
        const total = countResult[0].total;

        // Fetch paginated logs with user details and company_id filter
        const sql = `
            SELECT 
                l.id, 
                l.comment,
                l.user_id,
                u.name, 
                u.phone, 
                l.created_at
            FROM import_pppoe_plans_logs l
            JOIN users u ON l.user_id = u.id
            WHERE l.company_id = ?
            ORDER BY l.created_at DESC
            LIMIT ${db.escape(limit)} OFFSET ${db.escape(offset)}
        `;

        const [rows] = await db.query(sql, [company_id]);

        res.json({
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit),
            data: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// POST new log
router.post('/import-pppoe-plans-logs', verifyToken, async (req, res) => {
    try {
        const { comment, user_id } = req.body;
        const company_id = req.company_id; // from token

        if (!comment || !user_id) {
            return res.status(400).json({ error: 'comment and user_id are required' });
        }

        if (!company_id) {
            return res.status(400).json({ error: 'company_id is missing from token' });
        }

        const [result] = await db.execute(
            `INSERT INTO import_pppoe_plans_logs (comment, user_id, company_id) VALUES (?, ?, ?)`,
            [comment, user_id, company_id]
        );

        res.status(201).json({
            message: 'Log entry created successfully',
            log_id: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create log' });
    }
});

module.exports = router;
