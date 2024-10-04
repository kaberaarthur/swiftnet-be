const express = require('express');
const router = express.Router();
const db = require('../../dbPromise'); // Change to use `db` instead of `dbPromise`

// Create multiple vouchers
router.post('/hotspot-vouchers', async (req, res) => {
    const { code_length, company_id, company_username, plan_id, plan_name, plan_validity, router_id, router_name, voucherCodes } = req.body;

    try {
        const vouchers = voucherCodes.map(voucherCode => (`
            (${router_id}, '${router_name}', '${plan_name}', ${plan_id}, '${voucherCode}', '${company_username}', ${company_id}, ${plan_validity}, NOW())
        `)).join(', ');

        const query = `
            INSERT INTO hotspot_vouchers (router_id, router_name, plan_name, plan_id, voucher_code, company_username, company_id, plan_validity, date_created)
            VALUES ${vouchers}
        `;

        await db.execute(query);

        res.status(201).json({ success: true, message: 'Vouchers created successfully' });
    } catch (error) {
        console.error('Error inserting vouchers:', error);
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


module.exports = router;
