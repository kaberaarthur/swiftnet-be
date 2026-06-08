const jwt = require('jsonwebtoken');
const db = require('./dbPromise');

require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET;

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    const bearerToken = token.split(' ')[1];

    jwt.verify(bearerToken, jwtSecret, async (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        try {
            const [rows] = await db.execute(
                'SELECT active, token_version, deleted_at FROM users WHERE id = ?',
                [decoded.id]
            );
            if (rows.length === 0 || rows[0].deleted_at !== null || rows[0].active === 0) {
                return res.status(401).json({ message: 'Account is inactive or has been removed' });
            }
            if (rows[0].token_version !== decoded.token_version) {
                return res.status(401).json({ message: 'Session expired. Please sign in again.' });
            }
            req.userId = decoded.id;
            req.userType = decoded.user_type;
            req.companyId = decoded.company_id;
            req.company_id = decoded.company_id; // alias for files that use snake_case
            next();
        } catch (dbErr) {
            return res.status(500).json({ message: 'Authentication error' });
        }
    });
}

// ✅ Export the middleware
module.exports = { verifyToken };
