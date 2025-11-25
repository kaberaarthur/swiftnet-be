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
    jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Attach the user ID to the request object
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.companyId = decoded.company_id;
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

    jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
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

function generateRandomNumber() {
  return Math.floor(Math.random() * 100) + 1;
}

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
        // Fetch default values from company with id = 2
        const [defaultCompanyRows] = await connection.execute(
            'SELECT africas_talking_key, africas_talking_username, africas_talking_sender_id, mpesa_initiator_password FROM companies WHERE id = ?',
            [2]
        );

        if (defaultCompanyRows.length === 0) {
            await connection.rollback();
            return res.status(500).json({ message: 'Default company config not found' });
        }

        const defaultCompany = defaultCompanyRows[0];

        // Insert new company using default values from id = 2
        const [companyResult] = await connection.execute(
            `INSERT INTO companies 
                (company_name, username, active, phone_number, logo, address, 
                africas_talking_key, africas_talking_username, africas_talking_sender_id, mpesa_initiator_password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                company_name,
                company_username,
                0,
                phone,
                'default.png',
                'Nairobi',
                defaultCompany.africas_talking_key,
                defaultCompany.africas_talking_username,
                defaultCompany.africas_talking_sender_id,
                defaultCompany.mpesa_initiator_password
            ]
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
            { id: newUserId, user_type: defaultUserType, company_id: companyId },
            process.env.JWT_SECRET,
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

        if (user.active === 0) {
            return res.status(400).json({ message: 'You account is inactive, contact your Admin.' });
        }

        console.log("User Data: ", user);

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        console.log("JWT Secret Used: ", process.env.JWT_SECRET);

        // Create and return a token with user_type included
        const token = jwt.sign(
            { id: user.id, user_type: user.user_type, company_id: user.company_id }, // Include user_type
            process.env.JWT_SECRET,
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


// Route to get all users or a specific user by ID, filtered by company_id
router.get('/users/:id?', verifyToken, async (req, res) => {
    const userId = req.params.id;
    const companyId = req.companyId; // Use camelCase consistently

    console.log("Company ID: ", companyId);

    // Check if user is superadmin
    if (req.userType !== 'admin' && req.userType !== 'superadmin') {
        return res.status(403).json({
            message: 'Access denied: Admin or Superadmin privileges required'
        });
    }

    try {
        if (userId) {
            const [result] = await db.execute(
                'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE id = ? AND company_id = ?',
                [userId, companyId]
            );
            
            if (result.length === 0) {
                return res.status(404).json({ message: 'User not found or does not belong to your company' });
            }
            
            res.json(result[0]);
        } else {
            const [result] = await db.execute(
                'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE company_id = ?',
                [companyId]
            );
            
            res.json(result);
        }
    } catch (err) {
        res.status(500).json({ 
            message: 'Database query error', 
            error: err.message 
        });
    }
});

// Route to toggle the active status of a specific user by ID
router.patch('/users/:id/toggle-active', verifyToken, async (req, res) => {
    const userId = req.params.id;
    const companyId = req.companyId; // Extracted from token by verifyToken middleware

    // Check if user is admin
    if (req.userType !== 'admin') {
        return res.status(403).json({ 
            message: 'Access denied: Admin privileges required' 
        });
    }

    try {
        // Step 1: Fetch the user to verify company_id and get current active status
        const [userResult] = await db.execute(
            'SELECT company_id, active FROM users WHERE id = ?',
            [userId]
        );

        if (userResult.length === 0) {
            return res.status(404).json({ 
                message: 'User not found' 
            });
        }

        const user = userResult[0];

        // Step 2: Verify company_id matches
        if (user.company_id !== companyId) {
            return res.status(403).json({ 
                message: 'User does not belong to your company' 
            });
        }

        // Step 3: Toggle the active status
        const newActiveStatus = user.active === 1 ? 0 : 1;

        // Step 4: Update the user's active status
        await db.execute(
            'UPDATE users SET active = ? WHERE id = ?',
            [newActiveStatus, userId]
        );

        // Step 5: Fetch and return the updated user data
        const [updatedUserResult] = await db.execute(
            'SELECT id, name, email, phone, user_type, company_id, company_username, active FROM users WHERE id = ?',
            [userId]
        );

        res.json({
            message: 'User active status updated successfully',
            user: updatedUserResult[0]
        });

    } catch (err) {
        res.status(500).json({ 
            message: 'Database query error', 
            error: err.message 
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

// Create-user route
router.post('/create-user', verifyToken, async (req, res) => {
    try {
        const { name, email, phone, password, company_username } = req.body;
        const companyId = req.companyId;

        // Input validation
        if (!name || !email || !phone || !password || !company_username) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Check if user is admin
        if (req.userType !== 'admin' && req.userType !== 'superadmin') {
            return res.status(403).json({ 
                message: 'Access denied: Admin privileges required' 
            });
        }

        // Check if user already exists
        const [existingUsers] = await db.execute(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        if (existingUsers.length > 0) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        // Check if company exists and matches the provided username
        const [companyCheck] = await db.execute(
            'SELECT * FROM companies WHERE id = ? AND username = ?',
            [companyId, company_username]
        );
        if (companyCheck.length === 0) {
            return res.status(400).json({ 
                message: 'Company ID and username do not match or company does not exist' 
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 8);
        const defaultUserType = 'manager';

        // Insert user into users table
        const [userResult] = await db.execute(
            'INSERT INTO users (name, email, phone, password, user_type, company_id, company_username, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, defaultUserType, companyId, company_username, 1]
        );

        // Respond with success message only
        res.status(201).json({
            message: 'User created successfully', user: userResult
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ message: 'An error occurred during user creation' });
    }
});

// Add this new route after your existing routes

// Route to change user's password
router.post('/change-password', verifyToken, async (req, res) => {
    try {
        const userId = req.userId; // Get user ID from the token
        const { currentPassword, newPassword } = req.body;

        // Input validation
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters long' });
        }

        // Fetch the user from the database
        const [userResults] = await db.execute(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );

        if (userResults.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userResults[0];

        // Verify current password
        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Current password is incorrect' });
        }

        // Hash the new password
        const hashedNewPassword = await bcrypt.hash(newPassword, 8);

        // Update the password in the database
        await db.execute(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedNewPassword, userId]
        );

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ message: 'An error occurred while changing the password' });
    }
});

module.exports = router;
