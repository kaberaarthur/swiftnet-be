const express = require('express');
const router = express.Router();
const db = require('./db'); // Import your database connection

// Create a new log entry
router.post('/local_logs', (req, res) => {
    const { user_type, ip_address, description, company_id, company_username, user_id, name } = req.body;
    const sql = 'INSERT INTO local_logs (user_type, ip_address, description, company_id, company_username, user_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [user_type, ip_address, description, company_id, company_username, user_id, name], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: result.insertId });
    });
});

// Read all log entries with optional filtering
router.get('/local_logs', (req, res) => {
    const { company_id } = req.query;
    let sql = 'SELECT * FROM local_logs';
    const params = [];

    if (company_id) {
        sql += ' WHERE company_id = ?';
        params.push(company_id);
    }

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Update a log entry
router.put('/local_logs/:id', (req, res) => {
    const { id } = req.params;
    const { user_type, ip_address, description, company_id, company_username, user_id, name } = req.body;
    const sql = 'UPDATE local_logs SET user_type = ?, ip_address = ?, description = ?, company_id = ?, company_username = ?, user_id = ?, name = ? WHERE id = ?';
    db.query(sql, [user_type, ip_address, description, company_id, company_username, user_id, name, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Log updated successfully' });
    });
});

// Delete a log entry
router.delete('/local_logs/:id', (req, res) => {
    const { id } = req.params;
    const sql = 'DELETE FROM local_logs WHERE id = ?';
    db.query(sql, [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Log deleted successfully' });
    });
});

module.exports = router;
