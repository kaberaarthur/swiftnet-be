const express = require('express');
const db = require('../../dbPromise');
const redisClient = require("../../services/redis");

const router = express.Router();

// Endpoint to update reminder status - Updated to Include Redis for real-time updates
router.patch('/reminder/:customer_id', async (req, res) => {
  const { customer_id } = req.params;
  const { status } = req.body;

  if (!customer_id || !['enable', 'disable'].includes(status)) {
    return res.status(400).json({
      message: 'Invalid input: customer_id and status (enable/disable) are required'
    });
  }

  const reminderValue = status === 'enable' ? 1 : 0;

  try {
    // Push the update into Redis as a stringified object
    await redisClient.rPush(
      'reminder_updates',
      JSON.stringify({ customer_id, reminderValue })
    );

    res.json({
      message: `Reminder update queued for customer_id ${customer_id}`,
      reminder: reminderValue
    });
  } catch (err) {
    console.error('Error adding reminder update to Redis:', err);
    res.status(500).json({
      message: 'Redis error',
      error: err.message
    });
  }
});


// New endpoint to disable all reminders with value 1
router.patch('/reminder/all/reset', async (req, res) => {
    try {
        const [result] = await db.execute(
            'UPDATE pppoe_clients SET reminder = 1 WHERE reminder = 0'
        );

        res.json({
            message: 'All inactive reminders enabled',
            affectedRows: result.affectedRows
        });
    } catch (err) {
        console.error('Error enabling all inactive reminders:', err);
        res.status(500).json({
            message: 'Database error',
            error: err.message
        });
    }
});

router.get('/reminder-test', (req, res) => {
    res.json({
        message: 'Test endpoint is working',
        status: 'ok'
    });
});

module.exports = router;