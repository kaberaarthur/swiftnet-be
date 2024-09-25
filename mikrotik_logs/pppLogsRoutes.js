// mikrotik_logs/logsRoutes.js
const express = require('express');
const fetchMikrotikLogs = require('./pppFetchLogs'); // Import the log fetching function

const router = express.Router();

// Define a route to fetch the Hotspot logs
router.get('/pppoe-logs', (req, res) => {
    // Provide MikroTik credentials here or fetch them from config/environment variables
    const host = '102.0.5.26';  // Replace with your MikroTik router IP
    const username = 'Arthur';   // Replace with your MikroTik username
    const password = 'Arthur';   // Replace with your MikroTik password

    fetchMikrotikLogs(host, username, password, (err, logs) => {
        if (err) {
            return res.status(500).send('Error fetching logs: ' + err.message);
        }
        res.send(logs);  // Send the logs to the client
    });
});

// Export the router
module.exports = router;
