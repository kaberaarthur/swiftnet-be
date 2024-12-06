// Import Dependencies
const express = require('express');
const cors = require('cors');
const db = require('./dbPromise');
const bodyParser = require('body-parser');
const { Client } = require('ssh2');

// Import Routes
const userRoutes = require('./userRoutes');
const paymentRoutes = require('./paymentRoutes');
const companyRoutes = require('./companyRoutes');
const voucherRoutes = require('./voucherRoutes');
const routerRoutes = require('./routerRoutes');
const ipPoolRoutes = require('./ipPoolRoutes');
const logsRoutes = require('./mikrotik_logs/logsRoutes');
const pppLogsRoutes = require('./mikrotik_logs/pppLogsRoutes');
const localLogRoutes = require('./localLogRoutes');
const myIpRoutes = require('./myIpRoutes');
const { shortenUrl, getOriginalUrl } = require('./urlShortener');
const bandwidthRoutes = require('./bandwidthRoutes');
const freeIPRoutes = require('./freeIPRoutes');


// Actual Stuff
const hotspotPlansRoutes = require('./hotspot/hotspotPlansRoutes');
const staticPlansRoutes = require('./staticplans/staticPlansRoutes');
const pppoePlansRoutes = require('./pppoeplans/pppoePlansRoutes');

// Client Routes
const staticClientsRoutes = require('./clients/static/allroutes');
const pppoeClientsRoutes = require('./clients/pppoe/allroutes');
const hotspotClientsRoutes = require('./clients/hotspot/allroutes');

// Voucher Routes
const hotspotVouchersRoutes = require('./vouchers/hotspot/allroutes');

// PPPOE Payment Routes
const pppoePaymentsRoutes = require('./pppoe_payments/payments');

// Test package mikrotik-ng
const mikrotikRoutes = require('./mikrotikPackageTest');


const app = express();
const port = 8000;

// Payment Processing
const axios = require('axios');

// Allow requests from any origin
app.use(cors({
    origin: '*',  // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Specify allowed methods
    credentials: true,  // Optional: Use this if your requests need to include cookies
}));

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Use the user management routes
// app.use('/api', userRoutes);
app.use(userRoutes);
app.use(paymentRoutes)
app.use(companyRoutes)
app.use(voucherRoutes)
app.use(routerRoutes)
app.use(ipPoolRoutes)
app.use(logsRoutes);
app.use(myIpRoutes);
app.use(pppLogsRoutes);
app.use(localLogRoutes);
app.use(bandwidthRoutes);
app.use(freeIPRoutes);


// Actual Stuff
app.use(hotspotPlansRoutes);
app.use(staticPlansRoutes);
app.use(pppoePlansRoutes);

// Clients Routes
app.use(staticClientsRoutes);
app.use(pppoeClientsRoutes);
app.use(hotspotClientsRoutes);

// Voucher Routes
app.use(hotspotVouchersRoutes);

// PPPOE Payments Routes
app.use(pppoePaymentsRoutes);


// Mikrotik NG
app.use(mikrotikRoutes);


// Home route
app.get('/', (req, res) => {
    res.send('Welcome to the Home Page of our Node.js Application!');
});

// Test Mikrotik
// MikroTik SSH Connection Route
app.get('/test-mikrotik', (req, res) => {
    const conn = new Client();
    const mikrotikDetails = {
        host: '102.0.14.218',
        port: 22, // Default SSH port
        username: 'Arthur',
        password: 'Arthur'
    };

    const command = `/ip hotspot user add name="J5:B0:D0:63:C2:26" password="o&h0O%" profile="8hours"`;

    conn.on('ready', () => {
        console.log('SSH Connection to MikroTik established.');

        conn.exec(command, (err, stream) => {
            if (err) {
                console.error('Command execution failed:', err);
                conn.end();
                return res.status(500).send('Failed to execute command on MikroTik.');
            }

            let output = '';
            stream.on('data', (data) => {
                output += data.toString();
            }).on('close', () => {
                console.log('Command execution completed:', output);
                conn.end();
                res.send(`Command executed successfully: ${output}`);
            }).on('error', (err) => {
                console.error('Stream error:', err);
                conn.end();
                res.status(500).send('Error occurred while executing the command.');
            });
        });
    }).on('error', (err) => {
        console.error('SSH Connection error:', err);
        res.status(500).send('Failed to connect to MikroTik router.');
    }).connect(mikrotikDetails);
});

// Route to shorten a URL
app.post('/shorten', (req, res) => {
    const { originalUrl } = req.body;
    if (!originalUrl) return res.status(400).send('Original URL is required');

    shortenUrl(originalUrl, (err, shortUrl) => {
        if (err) return res.status(500).send('Error shortening URL');
        res.json({ shortUrl });
    });
});

// Route to redirect to the original URL using the short code
app.get('/:shortCode', (req, res) => {
    const { shortCode } = req.params;

    getOriginalUrl(shortCode, (err, originalUrl) => {
        if (err) return res.status(404).send('URL not found');
        res.redirect(originalUrl);
    });
});

// Function for Generating a Voucher Code
const generateVoucherCode = async (index, lastId) => {
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


// Handle Payment Requests
app.use(express.json());

// Middleware for Processing Payment
// Utility function for delay (10 seconds)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to check if CheckoutRequestID exists in the payments table
const checkForPayment = async (
    CheckoutRequestID,
    company_id,
    company_username,
    router_id,
    router_name,
    plan_id,
    plan_name,
    plan_validity,
    mac_address,
    phone_number,
    shared_users
) => {
    try {
        // First, check if the payment exists with the given CheckoutRequestID
        const [results] = await db.query(
            'SELECT * FROM payments WHERE CheckoutRequestID = ?',
            [CheckoutRequestID]
        );

        if (results.length > 0) {
            // Log the MpesaReceiptNumber field from the first result row
            const MpesaReceiptNumber = results[0].MpesaReceiptNumber;
            console.log(`MpesaReceiptNumber: ${MpesaReceiptNumber}`);

            // Update the payment if it exists
            const updatePayment = `
                UPDATE payments
                SET company_id = ?, company_username = ?, router_id = ?, router_name = ?, plan_id = ?, plan_name = ?, plan_validity = ?, mac_address = ?, phone_number = ?, usedStatus = ?
                WHERE CheckoutRequestID = ?
            `;
            await db.query(updatePayment, [
                company_id,
                company_username,
                router_id,
                router_name,
                plan_id,
                plan_name,
                plan_validity,
                mac_address,
                phone_number,
                "used",
                CheckoutRequestID,
            ]);

            // Count rows in hotspot_vouchers and generate a voucher code
            const [countResult] = await db.query(
                'SELECT COUNT(*) as total FROM hotspot_vouchers'
            );
            const totalRows = countResult[0].total;

            const voucherCode = await generateVoucherCode(1, totalRows);

            // Insert into hotspot_vouchers, including shared_users as total_users
            const insertQuery = `
                INSERT INTO hotspot_vouchers (
                    router_id, router_name, plan_name, plan_id, plan_validity, company_username, company_id, voucher_code, mpesa_code, mac_address, phone_number, total_users
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await db.query(insertQuery, [
                router_id,
                router_name,
                plan_name,
                plan_id,
                plan_validity,
                company_username,
                company_id,
                voucherCode,
                MpesaReceiptNumber,
                mac_address,
                phone_number,
                shared_users, // Insert shared_users as total_users
            ]);

            console.log('Voucher code generated and stored:', voucherCode);
            return {
                voucherCode,
                status: 'success',
            };
        } else {
            return {
                status: 200,
                message:
                    'We did not receive your payment on time, Contact Admin for Help.',
            };
        }
    } catch (err) {
        console.error('Database query error:', err);
        return {
            status: 200,
            message: "We couldn't process your payment. Contact Admin for Help!",
        };
    }
};


// POST endpoint: payment-request-pro
app.post('/payment-request-pro', async (req, res) => {
    const { phone_number, company_id, company_username, router_id, router_name, plan_id, mac_address } = req.body;

    try {
        // Query the hotspot_plans table for the actual plan details
        const [planResults] = await db.query(
            'SELECT plan_price, plan_validity, plan_name, router_name, router_id, shared_users FROM hotspot_plans WHERE id = ?',
            [plan_id]
        );

        if (planResults.length === 0) {
            return res.status(400).json({ error: "Error processing payment, cannot find the specified plan." });
        }

        // Destructure the necessary fields from the plan query results
        const { plan_price, plan_validity, plan_name, router_name, router_id, shared_users } = planResults[0];
        const amount = Math.floor(plan_price); // Assign plan_price to amount

        // Query the payhero_settings table
        const [payheroResults] = await db.query(
            'SELECT callback_url, channel_id, payhero_token FROM payhero_settings WHERE company_id = ?',
            [company_id]
        );

        if (payheroResults.length === 0) {
            return res.status(400).json({ error: "Error processing payment, cannot find payhero settings" });
        }

        const { callback_url, channel_id, payhero_token } = payheroResults[0];

        const paymentPayload = {
            amount,
            phone_number,
            channel_id: Number(channel_id),
            provider: "m-pesa",
            external_reference: "INV-009",
            callback_url
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `${payhero_token}`
        };

        try {
            // Make a POST request to the external payment service
            const paymentResponse = await axios.post(
                'https://backend.payhero.co.ke/api/v2/payments',
                paymentPayload,
                { headers }
            );

            const { success, status, reference, CheckoutRequestID } = paymentResponse.data;

            // SQL query to insert the payment response into the paymentrequests table
            const insertPaymentRequest = `
                INSERT INTO paymentrequests (success, status, reference, CheckoutRequestID, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity, mac_address, phone_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `;

            await db.query(insertPaymentRequest, [
                success, status, reference, CheckoutRequestID,
                company_id, company_username, router_id, router_name,
                plan_id, plan_name, plan_validity, mac_address, phone_number
            ]);

            if (success && CheckoutRequestID) {
                let paymentData = null;
                for (let attempt = 0; attempt < 6; attempt++) {
                    console.log(`Checking payment for CheckoutRequestID: ${CheckoutRequestID}, Attempt: ${attempt + 1}`);

                    // Check for payment in the 'payments' table
                    paymentData = await checkForPayment(
                        CheckoutRequestID, company_id, company_username,
                        router_id, router_name, plan_id, plan_name,
                        plan_validity, mac_address, phone_number, shared_users
                    );

                    if (paymentData && paymentData.voucherCode) {
                        return res.status(200).json({
                            message: 'Payment request processed successfully',
                            voucherCode: paymentData.voucherCode
                        });
                    }

                    // Wait for 10 seconds before the next attempt
                    await delay(10000);
                }

                // If no payment record is found after 6 tries, return failure
                return res.status(200).json({
                    status: 'failure',
                    message: 'Payment not found after multiple attempts.'
                });
            } else {
                // Handle case where the initial payment request fails
                return res.status(200).json({
                    status: 'failure',
                    message: paymentResponse.data.error_message || 'Payment request failed.'
                });
            }
        } catch (error) {
            console.error('Error making payment request:', error);
            return res.status(500).json({ error: 'An error occurred while processing the payment request.' });
        }
    } catch (err) {
        console.error('Error querying database:', err);
        return res.status(500).json({ error: 'Error processing payment request.', errorDetails: err.message || err });
    }
});





// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
