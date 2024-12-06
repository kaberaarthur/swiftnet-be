const express = require('express');
const router = express.Router();
const { Routeros } = require("routeros-node");

// Define router credentials
const router_IP = '102.0.14.218';
const router_username = 'Arthur';
const router_password = 'Arthur';
const router_port = 22; // Define the API port (default is 8728 for RouterOS API)

// Endpoint to create PPPoE secret
router.post('/create-pppoe-secret', (req, res) => {
    console.log("Starting Request");
    const { name, password, service, rateLimit } = req.body;

    if (!name || !password || !service || !rateLimit) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const routeros = new Routeros({
        host: router_IP,
        port: router_port,
        user: router_username,
        password: router_password,
    });

    // Connect to the router and execute the command
    routeros.connect()
        .then(conn => {
            return conn.write([
                "/ppp/secret/add",
                `=name=${name}`,
                `=password=${password}`,
                `=service=${service}`,
                `=rate-limit=${rateLimit}`
            ]).then(response => {
                conn.close(); // Close the connection
                res.status(201).json({ message: 'PPPoE secret created successfully', response });
            });
        })
        .catch(error => {
            res.status(500).json({ error: `Failed to create PPPoE secret: ${error.message}` });
        })
        .finally(() => {
            routeros.destroy(); // Ensure the connection is destroyed
        });
});

module.exports = router;
