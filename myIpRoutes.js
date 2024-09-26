const express = require('express');
const router = express.Router();

// Endpoint to get the client's IP address
router.get('/ipaddress/get-ip', (req, res) => {
    // Check if 'x-forwarded-for' header is present for proxies
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Handle IPv6 addresses
    if (ipAddress && ipAddress.startsWith('::ffff:')) {
        ipAddress = ipAddress.substr(7);
    }

    // Return the IP address in the response
    res.json({ ip: ipAddress });
});

module.exports = router;