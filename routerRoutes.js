const express = require('express');
const router = express.Router();
const db = require('./dbPromise');
const { verifyToken } = require('./systemFunctions');

// CREATE a new router entry
router.post('/routers', verifyToken, async (req, res) => {
    const company_id = req.companyId;

    // Check if user is admin - Only admins can perform these tasks
    if (req.userType !== 'admin' && req.userType !== 'superadmin') {
        return res.status(403).json({ 
            message: 'Access denied: Admin privileges required' 
        });
    }

    const {
        router_name,
        ip_address,
        username,
        interface,
        router_secret,
        description,
        company_username,
        created_by,
        port,
    } = req.body;

    const query = `
        INSERT INTO routers 
        (router_name, ip_address, username, interface, router_secret, description, company_username, company_id, created_by, port)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            port,
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
router.get('/routers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const companyIdFromToken = req.companyId;

    console.log("Router Company ID: ", companyIdFromToken);

    try {
        const [result] = await db.query(
            'SELECT * FROM routers WHERE id = ? AND company_id = ?', 
            [id, companyIdFromToken]
        );
        
        if (result.length === 0) {
            return res.status(404).json({ 
                message: 'Router not found or you do not have permission to access it' 
            });
        }
        
        res.status(200).json(result[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/routers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const companyIdFromToken = req.companyId;

    // Check if user is admin - Only admins can perform these tasks
    if (req.userType !== 'admin'  && req.userType !== 'superadmin') {
        return res.status(403).json({ 
            message: 'Access denied: Admin privileges required' 
        });
    }

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
        port,
    } = req.body;

    try {
        // First, fetch the existing router to check its company_id
        const [rows] = await db.query('SELECT company_id FROM routers WHERE id = ?', [id]);
        
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'Router not found' });
        }

        const routerCompanyId = rows[0].company_id;

        // Check if the router's company_id matches the user's companyId from token
        if (routerCompanyId !== companyIdFromToken) {
            return res.status(403).json({ 
                message: 'Access denied: You can only update routers belonging to your company' 
            });
        }

        // Object mapping column names to request body values
        const fieldsToUpdate = {
            router_name,
            ip_address,
            username,
            interface,
            router_secret,
            description,
            company_username,
            company_id: companyIdFromToken, // Enforce token's companyId, ignoring body value
            created_by,
            status,
            port,
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
router.delete('/routers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const companyIdFromToken = req.companyId;

    // Check if user is admin - Only admins can perform these tasks
    if (req.userType !== 'admin' && req.userType !== 'superadmin') {
        return res.status(403).json({ 
            message: 'Access denied: Admin privileges required' 
        });
    }

    try {
        const [result] = await db.query(
            'DELETE FROM routers WHERE id = ? AND company_id = ?', 
            [id, companyIdFromToken]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                message: 'Router not found or you do not have permission to delete it' 
            });
        }
        
        res.status(200).json({ message: 'Router deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;