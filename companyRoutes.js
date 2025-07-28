const express = require('express');
const db = require('./dbPromise');
const jwt = require('jsonwebtoken');

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    const bearerToken = token.split(' ')[1];
    
    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        req.userId = decoded.id;
        req.userType = decoded.user_type;
        next();
    });
}

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
router.post('/companies', verifyToken, async (req, res) => {
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

// Get all companies (GET)
router.get('/companies', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.userType !== 'superadmin') {
            return res.status(403).json({ 
                message: 'Access denied: Administrator privileges required' 
            });
        }

        const [result] = await db.execute('SELECT * FROM companies');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Get a single company by ID (GET)
router.get('/companies/:id', verifyToken, async (req, res) => {
    const companyId = req.params.id;

    try {
        const [result] = await db.execute('SELECT * FROM companies WHERE id = ?', [companyId]);
        if (result.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json(result[0]);
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Need Companies route to get company phone numbers for reminders and subscription termination
// Only allowed for local requests
// Middleware to check if request is from localhost
const allowLocalOnly = (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const allowedIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
    
    if (allowedIPs.includes(clientIP)) {
        next();
    } else {
        return res.status(403).json({ message: 'Access denied. Local requests only.' });
    }
};

// Get all companies (GET), only to be used locally, no token required
router.get('/local-companies', allowLocalOnly, async (req, res) => {
    try {
        const [result] = await db.execute('SELECT * FROM companies');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Update company details by ID (PATCH)
router.patch('/companies/:id', verifyToken, async (req, res) => {
    const companyId = req.params.id;
    const { company_name, address, phone_number, logo } = req.body;
    
    try {
        // Build dynamic query based on provided fields
        const updates = [];
        const values = [];
        
        if (company_name !== undefined) {
            updates.push('company_name = ?');
            values.push(company_name);
        }
        if (address !== undefined) {
            updates.push('address = ?');
            values.push(address);
        }
        if (phone_number !== undefined) {
            updates.push('phone_number = ?');
            values.push(phone_number);
        }
        if (logo !== undefined) {
            updates.push('logo = ?');
            values.push(logo);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields provided to update' });
        }

        values.push(companyId);
        const query = `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`;
        
        const [result] = await db.execute(query, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }

        res.json({ message: 'Company updated successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Database query error', error: err.message });
    }
});

// Delete company by ID (DELETE)
router.delete('/companies/:id', verifyToken, async (req, res) => {
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