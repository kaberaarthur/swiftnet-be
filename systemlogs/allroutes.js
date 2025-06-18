// routes/sms.js
const express = require('express');
const router = express.Router();
const db = require('../dbPromise');


router.post('/smslogs', async (req, res) => {
    try {
        const smsData = req.body.SMSMessageData;
        const recipient = smsData.Recipients[0]; // assuming one recipient

        const sql = `
            INSERT INTO sms_logs (
                number, status, status_code, message_id, cost, message_parts, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            recipient.number,
            recipient.status,
            recipient.statusCode,
            recipient.messageId,
            parseFloat(recipient.cost.replace('KES ', '')),
            recipient.messageParts,
            smsData.Message
        ];

        await db.execute(sql, values);

        res.status(200).json({ success: true, message: 'SMS log saved.' });
    } catch (err) {
        console.error('Error logging SMS:', err);
        res.status(500).json({ success: false, message: 'Failed to save SMS log.' });
    }
});

// GET: Paginated SMS logs (10 per page)
router.get('/smslogs', async (req, res) => {
    try {
        let currentPage = parseInt(req.query.page, 10);
        if (isNaN(currentPage) || currentPage < 1) currentPage = 1;

        const itemsPerPage = 10;
        const offset = (currentPage - 1) * itemsPerPage;

        const [countResult] = await db.execute(`SELECT COUNT(*) AS total FROM sms_logs`);
        const totalItems = countResult[0].total;
        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

        if (currentPage > totalPages) {
            return res.status(200).json({
                currentPage,
                totalItems,
                totalPages,
                itemsPerPage,
                data: []
            });
        }

        const [rows] = await db.execute(`
            SELECT id, number, status, created_at
            FROM sms_logs
            ORDER BY id DESC
            LIMIT ${itemsPerPage} OFFSET ${offset}
        `);

        res.status(200).json({
            currentPage,
            totalItems,
            totalPages,
            itemsPerPage,
            data: rows
        });

    } catch (err) {
        console.error('Error fetching paginated SMS logs:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch SMS logs.' });
    }
});


// POST: Get paginated SMS logs filtered by phone number
router.post('/smslogs/search', async (req, res) => {
    const { number } = req.body;

    // Validate number parameter
    if (!number || typeof number !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Phone number is required and must be a string.'
        });
    }

    try {
        // Parse and validate page query param
        let currentPage = parseInt(req.query.page, 10);
        if (isNaN(currentPage) || currentPage < 1) currentPage = 1;

        const itemsPerPage = 10;
        const offset = (currentPage - 1) * itemsPerPage;

        // Count query with number filter
        const [countResult] = await db.execute(
            'SELECT COUNT(*) AS total FROM sms_logs WHERE number LIKE ?',
            [`%${number}%`]
        );

        const totalItems = countResult[0].total;
        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

        // Return empty result if page is beyond total pages
        if (currentPage > totalPages) {
            return res.status(200).json({
                currentPage,
                totalItems,
                totalPages,
                itemsPerPage,
                data: []
            });
        }

        console.log('Number:', number, typeof number);
        console.log('Items Per Page:', itemsPerPage, typeof itemsPerPage);
        console.log('Offset:', offset, typeof offset);

        // Data query with number filter
        const [rows] = await db.query(
            `SELECT id, number, status, created_at
             FROM sms_logs
             WHERE number = ?
             ORDER BY id DESC
             LIMIT ${itemsPerPage} OFFSET ${offset}`,
            [number]
        );

        res.status(200).json({
            currentPage,
            totalItems,
            totalPages,
            itemsPerPage,
            data: rows
        });

    } catch (err) {
        console.error('Error fetching paginated SMS logs:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch SMS logs.' });
    }
});

router.get('/test-db-query', async (req, res) => {
    try {
        const testLimit = 5;
        const testOffset = 0;
        const testNumber = '+254790485731'; // Use a generic pattern if you don't have specific numbers

        console.log('Test parameters:', testNumber, testLimit, testOffset);

        const [rows] = await db.query(
            `SELECT id, number, status, created_at
             FROM sms_logs
             WHERE number = ?
             ORDER BY id DESC
             LIMIT ${testLimit} OFFSET ${testOffset}`,
            [testNumber]
        );

        console.log('Test query successful, rows:', rows.length);
        res.status(200).json({ success: true, message: 'Test query successful', data: rows });
    } catch (error) {
        console.error('Test query failed:', error);
        res.status(500).json({ success: false, message: 'Test query failed', error: error.message });
    }
});

module.exports = router;
