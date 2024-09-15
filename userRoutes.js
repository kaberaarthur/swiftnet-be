const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); // Import the db connection

const router = express.Router();

// Middleware to verify token
function verifyToken(req, res, next) {
    // Extract the token from the Authorization header
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    // Extract the token from the 'Authorization' header
    const bearerToken = token.split(' ')[1];

    
    // Verify the token
    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Attach the user ID to the request object
        req.userId = decoded.id;
        next();
    });
    
}

// Route to verify token and check expiration
router.get('/verify-token', (req, res) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    // Extract the token from the 'Authorization' header
    const bearerToken = token.split(' ')[1];  // Assuming the token is prefixed with 'Bearer'

    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Calculate the remaining time until token expiration
        const now = Math.floor(Date.now() / 1000);  // Current time in seconds
        const expiresIn = decoded.exp - now;  // Remaining seconds until expiration

        res.json({
            message: 'Token is valid',
            userId: decoded.id,
            expiresIn: expiresIn,  // Time in seconds until the token expires
            expiresAt: new Date(decoded.exp * 1000).toISOString()  // Expiration time in ISO format
        });
    });
});


// Signup route
router.post('/signup', (req, res) => {
    const { name, email, phone, password } = req.body;

    // Input validation (this is a simple example, more validation should be added)
    if (!name || !email || !phone || !password) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    // Check if user already exists
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) {
            console.error('Error during user lookup:', err);
            return res.status(500).json({ message: 'Database query error' });
        }

        if (result.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Hash the password asynchronously
        bcrypt.hash(password, 8, (err, hashedPassword) => {
            if (err) {
                console.error('Password hashing error:', err);
                return res.status(500).json({ message: 'Password hashing error' });
            }

            const defaultUserType = 'editor';
            const defaultCompanyId = null;
            const defaultCompanyName = null;
            const active = true;

            // Insert user into database
            db.query('INSERT INTO users (name, email, phone, password, user_type, company_id, company_name, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
            [name, email, phone, hashedPassword, defaultUserType, defaultCompanyId, defaultCompanyName, active], (err, result) => {
                if (err) {
                    console.error('Error during user insertion:', err);
                    return res.status(500).json({ message: 'Database query error' });
                }

                // Get the newly inserted user's ID
                const newUserId = result.insertId;

                // Create a token for the new user with 1 year expiration
                const token = jwt.sign({ id: newUserId }, 'your_jwt_secret', { expiresIn: '365d' });

                // Fetch the newly registered user details
                db.query('SELECT id, name, email, phone, user_type, company_id, company_name, active FROM users WHERE id = ?', [newUserId], (err, result) => {
                    if (err) {
                        console.error('Error fetching user details:', err);
                        return res.status(500).json({ message: 'Database query error' });
                    }

                    const user = result[0];

                    // Respond with user details and token
                    res.status(201).json({
                        message: 'User registered successfully',
                        token,
                        user
                    });
                });
            });
        });
    });
});

// Sign-in route
router.post('/signin', (req, res) => {
    const { email, password } = req.body;

    // Check if user exists
    db.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) return res.status(500).json({ message: 'Database query error' });

        if (result.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        }

        const user = result[0];

        // Check password
        const isPasswordValid = bcrypt.compareSync(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Create and return a token with 1 year expiration
        const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: '365d' });

        res.json({
            message: 'Sign-in successful',
            token,
            user,
        });
    });
});


// Route to get user details
router.get('/user', verifyToken, (req, res) => {
    const userId = req.userId;

    db.query('SELECT id, name, email, phone, user_type, company_id, company_name, active FROM users WHERE id = ?', [userId], (err, result) => {
        if (err) return res.status(500).json({ message: 'Database query error' });

        if (result.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = result[0];
        res.json(user);
    });
});

// Protected route example
router.get('/protected', verifyToken, (req, res) => {
    res.json({
        message: 'This is a protected route',
        userId: req.userId,
    });
});

// Route to get all users or a specific user by ID
router.get('/users/:id?', verifyToken, (req, res) => {
    const userId = req.params.id;

    if (userId) {
        db.query('SELECT id, name, email, phone, user_type, company_id, company_name, active FROM users WHERE id = ?', [userId], (err, result) => {
            if (err) return res.status(500).json({ message: 'Database query error' });

            if (result.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            res.json(result[0]);
        });
    } else {
        db.query('SELECT id, name, email, phone, user_type, company_id, company_name, active FROM users', (err, result) => {
            if (err) return res.status(500).json({ message: 'Database query error' });

            res.json(result);
        });
    }
});

module.exports = router;
