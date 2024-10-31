const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');

// Create a new hotspot client
router.post('/hotspot-clients', async (req, res) => {
    const { mac_address, plan_name, plan_id, plan_validity, phone_number, service_start, service_expiry, router_id, router_name, password, company_name, company_id } = req.body;

    try {
        const result = await db.query(
            `INSERT INTO hotspot_clients (mac_address, plan_name, plan_id, plan_validity, phone_number, service_start, service_expiry, router_id, router_name, password, company_name, company_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mac_address, plan_name, plan_id, plan_validity, phone_number, service_start, service_expiry, router_id, router_name, password, company_name, company_id]
        );

        res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
        console.error('Error creating hotspot client:', error);
        res.status(500).json({ error: 'Failed to create hotspot client' });
    }
});

// Get all hotspot clients with optional filtering by router_id and company_id
router.get('/hotspot-clients', async (req, res) => {
    const { router_id, company_id } = req.query; // Destructure the query parameters

    let query = 'SELECT * FROM hotspot_clients WHERE 1=1'; // Start with a base query
    const queryParams = [];

    // Append conditions based on query parameters
    if (router_id) {
        query += ' AND router_id = ?';
        queryParams.push(router_id);
    }

    if (company_id) {
        query += ' AND company_id = ?';
        queryParams.push(company_id);
    }

    try {
        const [rows] = await db.query(query, queryParams);

        // If no clients are found, return an empty array
        res.json(rows);
    } catch (error) {
        console.error('Error fetching hotspot clients:', error);
        res.status(500).json({ error: 'Failed to fetch hotspot clients' });
    }
});


// Find a hotspot client by mac_address and/or phone_number
router.get('/hotspot-clients-search', async (req, res) => {
    const { mac_address, phone_number } = req.query;

    let query = 'SELECT * FROM hotspot_clients WHERE 1=1'; // Start with a base query
    const queryParams = [];

    if (mac_address) {
        query += ' AND mac_address = ?';
        queryParams.push(mac_address);
    }

    if (phone_number) {
        query += ' AND phone_number = ?';
        queryParams.push(phone_number);
    }

    try {
        const [rows] = await db.query(query, queryParams);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No hotspot clients found matching the criteria' });
        }

        res.json(rows);
    } catch (error) {
        console.error('Error searching hotspot clients:', error);
        res.status(500).json({ error: 'Failed to search hotspot clients' });
    }
});


// Get a single hotspot client by ID
router.get('/hotspot-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(`SELECT * FROM hotspot_clients WHERE id = ?`, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Hotspot client not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching hotspot client:', error);
        res.status(500).json({ error: 'Failed to fetch hotspot client' });
    }
});

// Update a hotspot client
router.patch('/hotspot-clients/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Build the update query dynamically
    const updateFields = Object.keys(updates).map(field => `${field} = ?`).join(', ');
    const updateValues = Object.values(updates);

    try {
        const result = await db.query(
            `UPDATE hotspot_clients SET ${updateFields} WHERE id = ?`,
            [...updateValues, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Hotspot client not found' });
        }

        res.json({ id, ...updates });
    } catch (error) {
        console.error('Error updating hotspot client:', error);
        res.status(500).json({ error: 'Failed to update hotspot client' });
    }
});

// Delete a hotspot client
router.delete('/hotspot-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query(`DELETE FROM hotspot_clients WHERE id = ?`, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Hotspot client not found' });
        }

        res.status(204).send(); // No content to send back
    } catch (error) {
        console.error('Error deleting hotspot client:', error);
        res.status(500).json({ error: 'Failed to delete hotspot client' });
    }
});

module.exports = router;
