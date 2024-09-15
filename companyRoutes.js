const express = require('express');
const db = require('./db'); // Import the db connection

const router = express.Router();

// Helper function to generate a random 4-digit number
const generateRandomNumber = () => {
    return Math.floor(1000 + Math.random() * 9000); // Generates a 4-digit number
};

// Helper function to generate a unique username
const generateUniqueUsername = (company_name, callback) => {
    const baseUsername = `@${company_name.toLowerCase().replace(/\s+/g, '')}`; // Lowercase and remove spaces
    let username = baseUsername;

    const checkUsername = () => {
        db.query('SELECT COUNT(*) AS count FROM companies WHERE username = ?', [username], (err, result) => {
            if (err) return callback(err);

            const count = result[0].count;
            if (count > 0) {
                // Username exists, append a random 4-digit number
                username = `${baseUsername}${generateRandomNumber()}`;
                checkUsername(); // Recheck if the new username is unique
            } else {
                // Username is unique
                callback(null, username);
            }
        });
    };

    checkUsername(); // Start the username check
};

// Create a new company (POST)
router.post('/companies', (req, res) => {
    const { company_name, address, phone_number, logo } = req.body;

    // Generate a unique username
    generateUniqueUsername(company_name, (err, username) => {
        if (err) return res.status(500).json({ message: 'Error generating username' });

        // Insert the company into the database with the generated username
        db.query('INSERT INTO companies (company_name, address, phone_number, logo, username) VALUES (?, ?, ?, ?, ?)', 
        [company_name, address, phone_number, logo, username], (err, result) => {
            if (err) return res.status(500).json({ message: 'Database query error' });

            res.status(201).json({
                message: 'Company created successfully',
                companyId: result.insertId,
                username
            });
        });
    });
});

// Get all companies or a single company by ID (GET)
router.get('/companies/:id?', (req, res) => {
    const companyId = req.params.id;

    if (companyId) {
        db.query('SELECT * FROM companies WHERE id = ?', [companyId], (err, result) => {
            if (err) return res.status(500).json({ message: 'Database query error' });

            if (result.length === 0) {
                return res.status(404).json({ message: 'Company not found' });
            }

            res.json(result[0]);
        });
    } else {
        db.query('SELECT * FROM companies', (err, result) => {
            if (err) return res.status(500).json({ message: 'Database query error' });

            res.json(result);
        });
    }
});

// Update company details by ID (PUT)
router.put('/companies/:id', (req, res) => {
    const companyId = req.params.id;
    const { company_name, address, phone_number, logo } = req.body;

    db.query('UPDATE companies SET company_name = ?, address = ?, phone_number = ?, logo = ? WHERE id = ?', 
    [company_name, address, phone_number, logo, companyId], (err, result) => {
        if (err) return res.status(500).json({ message: 'Database query error' });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }

        res.json({ message: 'Company updated successfully' });
    });
});

// Delete company by ID (DELETE)
router.delete('/companies/:id', (req, res) => {
    const companyId = req.params.id;

    db.query('DELETE FROM companies WHERE id = ?', [companyId], (err, result) => {
        if (err) return res.status(500).json({ message: 'Database query error' });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }

        res.json({ message: 'Company deleted successfully' });
    });
});

module.exports = router;