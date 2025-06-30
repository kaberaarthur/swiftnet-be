const express = require('express');
const router = express.Router();
const db = require('./dbPromise');

// Create a new log entry
router.post('/local_logs', async (req, res) => {
    try {
        const { user_type, ip_address, description, company_id, company_username, user_id, name, router_id } = req.body;
        const sql = `
        INSERT INTO local_logs 
        (user_type, ip_address, description, company_id, company_username, user_id, name, router_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await db.query(sql, [
        user_type,
        ip_address,
        description,
        company_id,
        company_username,
        user_id,
        name,
        router_id // Added router_id to the values array
        ]);

        res.status(201).json({ id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/local_logs', async (req, res) => {
    try {
        const { company_id, router_id, page = 1, limit = 10 } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        let sql = 'SELECT * FROM local_logs';
        const params = [];

        if (company_id) {
            sql += ' WHERE company_id = ?';
            params.push(company_id);
        }

        if (router_id) {
            sql += params.length ? ' AND router_id = ?' : ' WHERE router_id = ?';
            params.push(router_id);
        }

        sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [results] = await db.query(sql, params);

        // Optional: Get total count for frontend pagination
        let countSql = 'SELECT COUNT(*) as total FROM local_logs';
        const countParams = [];

        if (company_id) {
            countSql += ' WHERE company_id = ?';
            countParams.push(company_id);
        }

        if (router_id) {
            countSql += countParams.length ? ' AND router_id = ?' : ' WHERE router_id = ?';
            countParams.push(router_id);
        }

        const [countResult] = await db.query(countSql, countParams);
        const total = countResult[0]?.total || 0;

        res.json({
            data: results,
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a log entry
router.put('/local_logs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { user_type, ip_address, description, company_id, company_username, user_id, name } = req.body;
        const sql = 'UPDATE local_logs SET user_type = ?, ip_address = ?, description = ?, company_id = ?, company_username = ?, user_id = ?, name = ? WHERE id = ?';
        await db.query(sql, [user_type, ip_address, description, company_id, company_username, user_id, name, id]);
        res.json({ message: 'Log updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a log entry
router.delete('/local_logs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const sql = 'DELETE FROM local_logs WHERE id = ?';
        await db.query(sql, [id]);
        res.json({ message: 'Log deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
