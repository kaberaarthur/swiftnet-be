const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./dbPromise');
const axios = require("axios");

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

// Signup route
router.post('/signup', async (req, res) => {
    let connection; // Declare connection variable for transaction
    
    try {
        const { name, email, phone, password, company_name } = req.body;

        // Input validation
        if (!name || !email || !phone || !password || !company_name) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Get a connection from the pool
        connection = await db.getConnection();
        
        // Begin transaction
        await connection.beginTransaction();

        // Check if user already exists
        const [existingUsers] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Email already in use' });
        }

        const company_username = await generateUniqueUsername(company_name);

        // Insert company into companies table
        const [companyResult] = await connection.execute(
            'INSERT INTO companies (company_name, username, active, phone_number, logo, address) VALUES (?, ?, ?, ?, ?, ?)',
            [company_name, company_username, 0, phone, 'default.png', 'Nairobi']
        );

        const companyId = companyResult.insertId;

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 8);
        const defaultUserType = 'editor';

        // Insert user into users table using the company ID
        const [userResult] = await connection.execute(
            'INSERT INTO users (name, email, phone, password, user_type, company_id, company_username, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, defaultUserType, companyId, company_username, 1]
        );

        const newUserId = userResult.insertId;

        // Create a token with user_type included
        const token = jwt.sign(
            { id: newUserId, user_type: defaultUserType },
            'your_jwt_secret',
            { expiresIn: '365d' }
        );

        // Fetch the newly registered user details
        const [userResults] = await connection.execute(
            'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE id = ?',
            [newUserId]
        );

        const user = userResults[0];

        // Commit the transaction
        await connection.commit();

        // Respond with user details and token
        res.status(201).json({
            message: 'User registered successfully',
            token,
            user
        });

    } catch (error) {
        console.error('Signup error:', error);
        if (connection) {
            await connection.rollback(); // Rollback if error occurs
        }
        res.status(500).json({ message: 'An error occurred during signup' });
    } finally {
        if (connection) {
            connection.release(); // Release the connection back to the pool
        }
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

        // Create and return a token with user_type included
        const token = jwt.sign(
            { id: user.id, user_type: user.user_type }, // Include user_type
            'your_jwt_secret',
            { expiresIn: '365d' }
        );

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

const AFRICASTALKING_API_URL = "https://api.africastalking.com/version1/messaging/bulk";
const AFRICASTALKING_API_KEY = "atsk_9cfc317182ef7086d1c0c7c4445f2a95fa4578a005917a45f5b9921539ae0fd1cde536d2";
const AFRICASTALKING_USERNAME = "Swiftnet_sms";
const SENDER_ID = "SwiftKenya";


// POST endpoint for sending OTP
router.post("/send-otp", async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    try {
        // Query the database and store result in a const
        const [rows] = await db.query("SELECT id FROM users WHERE phone = ?", [phoneNumber]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "This phone number is not registered" });
        }

        // If user exists, proceed to send OTP
        sendOtp(phoneNumber, res);
    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ success: false, message: "Database query error" });
    }
});

// Function to send OTP via Africa's Talking API and update the database
const sendOtp = async (phoneNumber, res) => {
    const otp = Math.floor(100000 + Math.random() * 900000); // Generate 6-digit OTP
    const message = `Your OTP is: ${otp}`;

    try {
        const response = await axios.post(
            AFRICASTALKING_API_URL,
            {
                username: AFRICASTALKING_USERNAME,
                message,
                senderId: SENDER_ID,
                phoneNumbers: [phoneNumber],
            },
            {
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    apiKey: AFRICASTALKING_API_KEY,
                },
            }
        );

        // Update OTP in the database after successful sending
        await db.query("UPDATE users SET otp = ? WHERE phone = ?", [otp, phoneNumber]);

        res.json({
            success: true,
            message: "OTP sent successfully",
            otp, // Send OTP back (for testing, remove in production)
            response: response.data,
        });
    } catch (error) {
        console.error("Error sending OTP:", error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: "Failed to send OTP",
        });
    }
};

// POST endpoint for resetting password
router.post("/reset-password", async (req, res) => {
    const { phoneNumber, otp, password } = req.body;

    if (!phoneNumber || !otp || !password) {
        return res.status(400).json({ success: false, message: "Phone number, OTP, and password are required" });
    }

    try {
        // Check if user exists and OTP matches
        const [rows] = await db.query("SELECT id, otp FROM users WHERE phone = ?", [phoneNumber]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "This phone number is not registered" });
        }

        const user = rows[0];

        if (user.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(password, 8);

        // Update the password in the database
        await db.query("UPDATE users SET password = ?, otp = NULL WHERE phone = ?", [hashedPassword, phoneNumber]);

        res.json({ success: true, message: "Password reset successfully" });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ success: false, message: "Database query error" });
    }
});

module.exports = router;
