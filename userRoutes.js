const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./dbPromise');

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

// Test Route
router.get('/message', (req, res) => {
    res.send('Hello, this is your message!');
});

// Signup route
router.post('/signup', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        console.log(req.body);

        // Input validation
        if (!name || !email || !phone || !password) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }
        console.log("This point");

        // Check if user already exists
        const [existingUsers] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 8);

        const defaultUserType = 'customer';
        const defaultCompanyId = 2;
        const defaultCompanyName = "@kijaniinternet";
        const active = true;

        // Insert user into database
        const [insertResult] = await db.execute(
            'INSERT INTO users (name, email, phone, password, user_type, company_id, company_username, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, defaultUserType, defaultCompanyId, defaultCompanyName, active]
        );

        const newUserId = insertResult.insertId;

        // Create a token for the new user with 1 year expiration
        const token = jwt.sign({ id: newUserId }, 'your_jwt_secret', { expiresIn: '365d' });

        // Fetch the newly registered user details
        const [userResults] = await db.execute(
            'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE id = ?',
            [newUserId]
        );

        const user = userResults[0];

        // Respond with user details and token
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ message: 'An error occurred during signup' });
    }
});

// Sign-in route
router.post('/signin', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const [results] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        
        if (results.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        }

        const user = results[0];

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Create and return a token with 1 year expiration
        const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: '365d' });

        // Remove password from user object before sending the response
        const { password: userPassword, ...userWithoutPassword } = user;

        res.json({
            message: 'Sign-in successful',
            token,
            user: userWithoutPassword,
        });
    } catch (error) {
        console.error('Sign-in error:', error);
        res.status(500).json({ message: 'An error occurred during sign-in' });
    }
});


// Route to get user details
router.get('/user', verifyToken, async (req, res) => {
    try {
        const userId = req.userId;

        const [results] = await db.execute(
            'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE id = ?', 
            [userId]
        );

        if (results.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = results[0];
        res.json(user);
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ message: 'An error occurred while retrieving user details' });
    }
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
