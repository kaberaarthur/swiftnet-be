const db = require('../dbPromise');
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_SECRET;

async function deleteOldRedeemedVouchers() {
  try {
    // Delete rows where redeemed = 1 and created_at is older than 7 days
    const [result] = await db.execute(
      `DELETE FROM vouchers 
       WHERE redeemed = 1 
       AND created_at < NOW() - INTERVAL 7 DAY`
    );

    console.log(`${result.affectedRows} old redeemed voucher(s) deleted.`);
    return { success: true, deleted: result.affectedRows };
  } catch (error) {
    console.error('Error deleting old redeemed vouchers:', error);
    return { success: false, message: 'Database error', error };
  }
}

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
    jwt.verify(bearerToken, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Attach the user ID to the request object
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.companyId = decoded.company_id;
        next();
    });
    
};


// Character set for passwords and vouchers
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const charLength = characters.length;

// Function to generate a 6-character password
function generatePassword() {
    let password = '';
    for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * charLength);
        password += characters[randomIndex];
    }
    return password;
}

// Function to generate an 8-character unique voucher
async function generateUniqueVoucher(maxRetries = 5) {
    let retries = 0;
    while (retries < maxRetries) {
        let voucher = '';
        for (let i = 0; i < 8; i++) {
            const randomIndex = Math.floor(Math.random() * charLength);
            voucher += characters[randomIndex];
        }

        try {
            // Check if voucher exists in the database
            const [existing] = await db.query('SELECT code_voucher FROM vouchers WHERE code_voucher = ?', [voucher]);
            if (existing.length === 0) {
                return voucher;
            }
            // Voucher exists, retry
            retries++;
        } catch (error) {
            throw new Error(`Database error: ${error.message}`);
        }
    }
    throw new Error('Max retries reached. Could not generate a unique voucher.');
}

// Main function to create a voucher
async function createVoucher(plan_id, customer) {
    try {
        // Query to select plan details
        const [rows] = await db.execute(
            'SELECT company_id, router_id, company_username, plan_name, plan_validity FROM hotspot_plans WHERE id = ?',
            [plan_id]
        );

        // Check if plan exists
        if (rows.length === 0) {
            throw new Error('Plan not found');
        }

        const plan = rows[0];
        
        // Generate unique voucher
        const voucherCode = await generateUniqueVoucher();
        console.log('Generated voucher code:', voucherCode);
        
        // Insert voucher into database
        const [result] = await db.execute(
            'INSERT INTO vouchers (code_voucher, plan_id, company_id, router_id, company_username, plan_name, plan_validity, customer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                voucherCode,
                plan_id,
                plan.company_id,
                plan.router_id,
                plan.company_username,
                plan.plan_name,
                plan.plan_validity,
                customer
            ]
        );

        // Return voucher details
        return {
            success: true,
            voucher_code: voucherCode,
            plan_id,
            company_id: plan.company_id,
            router_id: plan.router_id,
            company_username: plan.company_username,
            plan_name: plan.plan_name,
            plan_validity: plan.plan_validity,
            voucher_id: result.insertId,
            customer: customer,
        };

    } catch (error) {
        console.error('Error creating voucher:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

module.exports = {
    deleteOldRedeemedVouchers,
    verifyToken,
    generatePassword,
    generateUniqueVoucher,
    createVoucher
};