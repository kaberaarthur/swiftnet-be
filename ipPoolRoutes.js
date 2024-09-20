const express = require('express');
const router = express.Router();
const db = require('./db'); // Assuming you have your MySQL setup in db.js

// CREATE a new IP pool
router.post('/ippools', (req, res) => {
    const { company_username, company_id, router_id, router_name, name, ranges, mikrotik_gen_id } = req.body;

    const sql = `INSERT INTO ippools (company_username, company_id, router_id, router_name, name, ranges, mikrotik_gen_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [company_username, company_id, router_id, router_name, name, ranges, mikrotik_gen_id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(201).send({ id: result.insertId, ...req.body });
    });
});

// READ all IP pools or search by company_username
router.get('/ippools', (req, res) => {
    const { company_id } = req.query;
    let sql = 'SELECT * FROM ippools';
    let params = [];

    if (company_id) {
        sql += ' WHERE company_id = ?';
        params.push(company_id);
    }

    db.query(sql, params, (err, results) => {
        if (err) {
            return res.status(500).send(err);
        }
        res.status(200).send(results);
    });
});

// READ a single IP pool by ID
router.get('/ippools/:id', (req, res) => {
    const { id } = req.params;

    const sql = 'SELECT * FROM ippools WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        if (result.length === 0) {
            return res.status(404).send('IP pool not found');
        }
        res.status(200).send(result[0]);
    });
});

// UPDATE an existing IP pool by ID
router.put('/ippools/:id', (req, res) => {
    const { id } = req.params;
    const { company_username, company_id, router_id, router_name, name, ranges, mikrotik_gen_id } = req.body;

    const sql = `UPDATE ippools 
                 SET company_username = ?, company_id = ?, router_id = ?, router_name = ?, name = ?, ranges = ?, mikrotik_gen_id = ?
                 WHERE id = ?`;

    db.query(sql, [company_username, company_id, router_id, router_name, name, ranges, mikrotik_gen_id, id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('IP pool not found');
        }
        res.status(200).send({ id, ...req.body });
    });
});

// DELETE an IP pool by ID
router.delete('/ippools/:id', (req, res) => {
    const { id } = req.params;

    const sql = 'DELETE FROM ippools WHERE id = ?';
    db.query(sql, [id], (err, result) => {
        if (err) {
            return res.status(500).send(err);
        }
        if (result.affectedRows === 0) {
            return res.status(404).send('IP pool not found');
        }
        res.status(204).send();
    });
});

module.exports = router;
