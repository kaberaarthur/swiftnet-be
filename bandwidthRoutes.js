const express = require('express');
const router = express.Router();
const db = require('./db');

// GET all bandwidths for a specific company or all if no filter is applied
router.get('/bandwidths', (req, res) => {
    const companyId = req.query.company_id;

    // Define the base query
    let query = 'SELECT id, name, rate, date_created, company_id, company_username FROM bandwidths';
    const params = [];

    // If companyId is provided, filter by it
    if (companyId) {
        query += ' WHERE company_id = ?';
        params.push(companyId);
    }

    db.query(query, params, (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database query error' });
        }
        res.json(results);
    });
});


// GET a specific bandwidth by ID
router.get('/bandwidths/:id', (req, res) => {
    const bandwidthId = req.params.id;
    const query = 'SELECT id, name, rate, date_created, company_id, company_username FROM bandwidths WHERE id = ?';

    db.query(query, [bandwidthId], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database query error' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Bandwidth not found' });
        }
        res.json(results[0]); // Return the found bandwidth object
    });
});


// POST create a new bandwidth
router.post('/bandwidths', (req, res) => {
    const { name, rate, company_id, company_username } = req.body;
    const query = 'INSERT INTO bandwidths (name, rate, company_id, company_username, date_created) VALUES (?, ?, ?, ?, NOW())';
    
    db.query(query, [name, rate, company_id, company_username], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database insert error' });
        }
        res.status(201).json({ id: results.insertId, name, rate, company_id, company_username });
    });
});

// PUT update a bandwidth
router.put('/bandwidths/:id', (req, res) => {
    const bandwidthId = req.params.id;
    const { name, rate } = req.body;

    // Fetch original values if not provided
    const selectQuery = 'SELECT * FROM bandwidths WHERE id = ?';
    db.query(selectQuery, [bandwidthId], (error, results) => {
        if (error || results.length === 0) {
            return res.status(404).json({ error: 'Bandwidth not found' });
        }
        
        const original = results[0];

        const updatedName = name || original.name;
        const updatedRate = rate || original.rate;

        const updateQuery = 'UPDATE bandwidths SET name = ?, rate = ? WHERE id = ?';
        db.query(updateQuery, [updatedName, updatedRate, bandwidthId], (error) => {
            if (error) {
                return res.status(500).json({ error: 'Database update error' });
            }
            res.json({ id: bandwidthId, name: updatedName, rate: updatedRate });
        });
    });
});

// DELETE a bandwidth
router.delete('/bandwidths/:id', (req, res) => {
    const bandwidthId = req.params.id;
    const query = 'DELETE FROM bandwidths WHERE id = ?';
    
    db.query(query, [bandwidthId], (error, results) => {
        if (error) {
            return res.status(500).json({ error: 'Database delete error' });
        }
        if (results.affectedRows === 0) {
            return res.status(404).json({ error: 'Bandwidth not found' });
        }
        // Send a success message after successful deletion
        res.status(200).json({ message: 'Bandwidth deleted successfully' });
    });
});


module.exports = router;
