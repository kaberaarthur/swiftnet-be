const express = require('express');
const db = require('./dbPromise');

const router = express.Router();

// Helper function to generate a random 4-digit number
const generateRandomNumber = () => Math.floor(1000 + Math.random() * 9000);

// Helper function to generate a unique username
const generateUniqueUsername = async (company_name, maxRetries = 10) => {
    const baseUsername = `@${company_name.toLowerCase().replace(/\s+/g, '')}`;
    let username = baseUsername;
    let attempts = 0;

    while (attempts < maxRetries) {
        const [result] = await db.execute('SELECT COUNT(*) AS count FROM companies WHERE username = ?', [username]);
        if (result[0].count === 0) return username;
        username = `${baseUsername}${generateRandomNumber()}`;
        attempts++;
    }
    throw new Error('Unable to generate unique username after maximum retries');
};

// Create a new company (POST)
router.post('/companies', async (req, res) => {
    const { company_name, address, phone_number, logo } = req.body;

    try {
        const username = await generateUniqueUsername(company_name);
        const [result] = await db.execute(
            'INSERT INTO companies (company_name, address, phone_number, logo, username) VALUES (?, ?, ?, ?, ?)',
            [company_name, address, phone_number, logo, username]
        );

        res.status(201).json({
            message: 'Company created successfully',
            companyId: result.insertId,
            username
        });
    } catch (err) {
        res.status(500).json({ message: 'Error creating company', error: err.message });
    }
});

// Get all companies or a single company by ID (GET)
router.get('/companies/:id?', async (req, res) => {
    const companyId = req.params.id;

    try {
        if (companyId) {
            const [result] = await db.execute('SELECT * FROM companies WHERE id = ?', [companyId]);
            if (result.length === 0) {
                return res.status(404).json({ message: 'Company not found' });
            }
            res.json(result[0]);
        } else {
            const [result] = await db.execute('SELECT * FROM companies', []);
            res.json(result);
        }
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Update company details by ID (PUT)
router.put('/companies/:id', async (req, res) => {
    const companyId = req.params.id;
    const { company_name, address, phone_number, logo } = req.body;

    try {
        const [result] = await db.execute(
            'UPDATE companies SET company_name = ?, address = ?, phone_number = ?, logo = ? WHERE id = ?',
            [company_name, address, phone_number, logo, companyId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }

        res.json({ message: 'Company updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Delete company by ID (DELETE)
router.delete('/companies/:id', async (req, res) => {
    const companyId = req.params.id;

    try {
        const [result] = await db.execute('DELETE FROM companies WHERE id = ?', [companyId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }

        res.json({ message: 'Company deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

module.exports = router;