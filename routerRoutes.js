const express = require('express');
const router = express.Router();
const db = require('./db');

// CREATE a new router entry
router.post('/routers', (req, res) => {
    const { router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by } = req.body;
    
    const query = `
        INSERT INTO routers 
        (router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.query(query, [router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Router added successfully', id: result.insertId });
    });
});

// READ all routers or filter by company_id
router.get('/routers', (req, res) => {
    const { company_id } = req.query;
    let query = 'SELECT * FROM routers';
    let queryParams = [];

    if (company_id) {
        query += ' WHERE company_id = ?';
        queryParams.push(company_id);
    }

    db.query(query, queryParams, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json(results);
    });
});

// READ a single router by ID
router.get('/routers/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT * FROM routers WHERE id = ?', [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (result.length === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json(result[0]);
    });
});

// UPDATE a router by ID
router.put('/routers/:id', (req, res) => {
    const { id } = req.params;
    const { router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by, status } = req.body;

    // Object that maps the column names to the values from the request body
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

    // Array to hold the set clauses (e.g. "router_name = ?") and values
    let setClauses = [];
    let values = [];

    // Dynamically construct the query for fields that are not undefined
    Object.keys(fieldsToUpdate).forEach((field) => {
        if (fieldsToUpdate[field] !== undefined) { // Only include non-undefined fields
            setClauses.push(`${field} = ?`);
            values.push(fieldsToUpdate[field]);
        }
    });

    // If no fields are provided, return an error
    if (setClauses.length === 0) {
        return res.status(400).json({ message: 'No fields provided to update' });
    }

    // Construct the final query
    const query = `
        UPDATE routers SET ${setClauses.join(', ')}
        WHERE id = ?
    `;

    // Add the id to the values array for the WHERE clause
    values.push(id);

    // Execute the query
    db.query(query, values, (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json({ message: 'Router updated successfully' });
    });
});


// DELETE a router by ID
router.delete('/routers/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM routers WHERE id = ?', [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }
        res.status(200).json({ message: 'Router deleted successfully' });
    });
});

module.exports = router;
