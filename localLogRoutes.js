const express = require('express');
const router = express.Router();
const db = require('./dbPromise');

// Create a new log entry
router.post('/local_logs', async (req, res) => {
    try {
        const { user_type, ip_address, description, company_id, company_username, user_id, name } = req.body;
        const sql = 'INSERT INTO local_logs (user_type, ip_address, description, company_id, company_username, user_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const result = await db.query(sql, [user_type, ip_address, description, company_id, company_username, user_id, name]);
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Read all log entries with optional filtering
router.get('/local_logs', async (req, res) => {
    try {
        const { company_id, router_id } = req.query;
        let sql = 'SELECT * FROM local_logs';
        const params = [];

        if (company_id) {
            sql += ' WHERE company_id = ?';
            params.push(company_id);
        }

        if (router_id) {
            sql += ' WHERE router_id = ?';
            params.push(router_id);
        }

        const results = await db.query(sql, params);
        res.json(results);
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
