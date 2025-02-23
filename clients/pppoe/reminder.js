const express = require('express');
const db = require('../../dbPromise');

const router = express.Router();

// Endpoint to update reminder status
router.patch('/reminder/:customer_id', async (req, res) => {
    const { customer_id } = req.params; // Get customer_id from URL
    const { status } = req.body; // Expect 'enable' or 'disable' in the request body

    console.log("Received Status Request: ", status)

    // Validate input
    if (!customer_id || !['enable', 'disable'].includes(status)) {
        return res.status(400).json({
            message: 'Invalid input: customer_id and status (enable/disable) are required'
        });
    }

    // Map 'enable'/'disable' to 1/0
    const reminderValue = status === 'enable' ? 1 : 0;

    try {
        // Update the reminder field in the pppoe_clients table
        const [result] = await db.execute(
            'UPDATE pppoe_clients SET reminder = ? WHERE id = ?',
            [reminderValue, customer_id]
        );

        // Check if any rows were affected
        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: `No client found with customer_id ${customer_id}`
            });
        }

        res.json({
            message: `Reminder status updated to ${status} for customer_id ${customer_id}`,
            customer_id,
            reminder: reminderValue
        });
    } catch (err) {
        console.error(`Error updating reminder status for customer_id ${customer_id}:`, err);
        res.status(500).json({
            message: 'Database error',
            error: err.message
        });
    }
});

module.exports = router;