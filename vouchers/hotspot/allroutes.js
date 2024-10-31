const express = require('express');
const router = express.Router();
const db = require('../../dbPromise'); // Change to use `db` instead of `dbPromise`

// Function to generate a voucher code
const generateVoucherCode = async (connection, index, lastId) => {
    // Get the current month and day of the week
    const now = new Date();
    const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    const monthLetter = months[now.getMonth()]; // e.g. "S" for September
    const dayLetter = days[now.getDay()]; // e.g. "M" for Monday

    // Generate a random uppercase letter
    const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26)); // "A" to "Z"

    // Create the code using the last ID plus the current index
    const numberPart = String(lastId + index).padStart(4, '0'); // Ensures it has 4 digits, e.g., "0001"

    // Combine everything
    return `${monthLetter}${dayLetter}${randomLetter}${numberPart}`; // e.g., "SMV0001"
};

// Create multiple vouchers
router.post('/hotspot-vouchers', async (req, res) => {
    const { company_id, company_username, plan_id, plan_name, plan_validity, router_id, router_name, voucherCodes } = req.body;

    let connection;
    try {
        connection = await db.getConnection(); // Get the database connection

        // Query to get the last used voucher ID from the `hotspot_vouchers` table
        const [rows] = await connection.query('SELECT MAX(id) AS lastId FROM hotspot_vouchers');
        const lastId = rows[0].lastId || 0; // Start from 0 if there are no vouchers

        // Generate vouchers dynamically based on the number of voucher codes
        const vouchers = await Promise.all(voucherCodes.map(async (voucherCode, index) => {
            // Generate a unique voucher code, incrementing from lastId
            const generatedCode = await generateVoucherCode(connection, index + 1, lastId);
            return (`(${router_id}, '${router_name}', '${plan_name}', ${plan_id}, '${generatedCode}', '${company_username}', ${company_id}, ${plan_validity}, NOW())`);
        }));

        const query = `
            INSERT INTO hotspot_vouchers (router_id, router_name, plan_name, plan_id, voucher_code, company_username, company_id, plan_validity, date_created)
            VALUES ${vouchers.join(', ')}
        `;

        await connection.execute(query);
        connection.release(); // Release the connection back to the pool

        res.status(201).json({ success: true, message: 'Vouchers created successfully' });
    } catch (error) {
        console.error('Error inserting vouchers:', error);
        if (connection) connection.release(); // Ensure connection is released even on error
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Read vouchers with filters
router.get('/hotspot-vouchers', async (req, res) => {
    const { router_id, company_id } = req.query;

    try {
        let query = 'SELECT * FROM hotspot_vouchers WHERE 1=1'; // Basic query to start with

        if (router_id) {
            query += ` AND router_id = ${router_id}`;
        }
        if (company_id) {
            query += ` AND company_id = ${company_id}`;
        }

        const [rows] = await db.execute(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching vouchers:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update a voucher
router.patch('/hotspot-vouchers/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        const updateStatements = Object.entries(updates).map(([key, value]) => {
            return `${key} = ${typeof value === 'string' ? `'${value}'` : value}`;
        }).join(', ');

        const query = `
            UPDATE hotspot_vouchers
            SET ${updateStatements}
            WHERE id = ${id}
        `;

        await db.execute(query);
        res.status(200).json({ success: true, message: 'Voucher updated successfully' });
    } catch (error) {
        console.error('Error updating voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete a voucher
router.delete('/hotspot-vouchers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            DELETE FROM hotspot_vouchers
            WHERE id = ${id}
        `;

        await db.execute(query);
        res.status(200).json({ success: true, message: 'Voucher deleted successfully' });
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete all vouchers with status 'used'
router.delete('/hotspot-vouchers-delete-all', async (req, res) => {
    try {
        const query = `
            DELETE FROM hotspot_vouchers
            WHERE status = 'used'
        `;

        const [result] = await db.execute(query);
        res.status(200).json({ success: true, message: 'All used vouchers deleted successfully', affectedRows: result.affectedRows });
    } catch (error) {
        console.error('Error deleting used vouchers:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Redeem a voucher
router.post('/hotspot-vouchers-redeem', async (req, res) => {
    const { router_id, voucherCode } = req.body;

    let connection;
    try {
        connection = await db.getConnection();

        // Check if the voucher exists with the provided voucher_code
        const [voucher] = await connection.query(
            `SELECT * FROM hotspot_vouchers WHERE voucher_code = ?`,
            [voucherCode]
        );

        if (voucher.length === 0) {
            connection.release();
            return res.status(200).json({ success: false, message: 'Voucher not found' });
        }

        // Check if the router_id matches
        const voucherData = voucher[0];
        if (voucherData.router_id !== router_id) {
            connection.release();
            return res.status(200).json({ success: false, message: 'You are on the wrong router' });
        }

        // Check if the voucher has already been used
        if (voucherData.status === 'used') {
            connection.release();
            return res.status(200).json({ success: false, message: 'Voucher has already been used' });
        }

        // Update voucher status to "used" and set the `voucher_redeemed_at` timestamp
        await connection.query(
            `UPDATE hotspot_vouchers
             SET status = 'used', voucher_redeemed_at = NOW()
             WHERE voucher_code = ?`,
            [voucherCode]
        );

        connection.release();
        res.status(200).json({ success: true, message: 'Voucher redeemed successfully' });
    } catch (error) {
        console.error('Error redeeming voucher:', error);
        if (connection) connection.release();
        res.status(200).json({ success: false, message: 'Server error' });
    }
});



module.exports = router;
