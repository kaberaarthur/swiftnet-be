const express = require('express');
const router = express.Router();
const db = require('./dbPromise'); // Import the promise-based database pool

// CREATE a new router entry
router.post('/routers', async (req, res) => {
    const {
        router_name,
        ip_address,
        username,
        interface,
        router_secret,
        description,
        company_username,
        company_id,
        created_by,
    } = req.body;

    const query = `
        INSERT INTO routers 
        (router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        const [result] = await db.query(query, [
            router_name,
            ip_address,
            username,
            interface,
            router_secret,
            description,
            company_username,
            company_id,
            created_by,
        ]);
        res.status(201).json({ message: 'Router added successfully', id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// READ all routers or filter by company_id
router.get('/routers', async (req, res) => {
    const { company_id } = req.query;
    let query = 'SELECT * FROM routers';
    let queryParams = [];

    if (company_id) {
        query += ' WHERE company_id = ?';
        queryParams.push(company_id);
    }

    try {
        const [results] = await db.query(query, queryParams);
        res.status(200).json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// READ a single router by ID
router.get('/routers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query('SELECT * FROM routers WHERE id = ?', [id]);
        if (result.length === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json(result[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE a router by ID
router.put('/routers/:id', async (req, res) => {
    const { id } = req.params;
    const {
        router_name,
        ip_address,
        username,
        interface,
        router_secret,
        description,
        company_username,
        company_id,
        created_by,
        status,
    } = req.body;

    // Object mapping column names to request body values
    const fieldsToUpdate = {
        router_name,
        ip_address,
        username,
        interface,
        router_secret,
        description,
        company_username,
        company_id,
        created_by,
        status,
    };

    // Build query dynamically for non-undefined fields
    const setClauses = [];
    const values = [];
    for (const [field, value] of Object.entries(fieldsToUpdate)) {
        if (value !== undefined) {
            setClauses.push(`${field} = ?`);
            values.push(value);
        }
    }

    if (setClauses.length === 0) {
        return res.status(400).json({ message: 'No fields provided to update' });
    }

    const query = `
        UPDATE routers SET ${setClauses.join(', ')}
        WHERE id = ?
    `;
    values.push(id);

    try {
        const [result] = await db.query(query, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json({ message: 'Router updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE a router by ID
router.delete('/routers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query('DELETE FROM routers WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json({ message: 'Router deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
