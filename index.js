// Import Dependencies
const express = require('express');
const cors = require('cors');
const db = require('./db');
const bodyParser = require('body-parser');

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

// Client Routes
const staticClientsRoutes = require('./clients/static/allroutes');
const pppoeClientsRoutes = require('./clients/pppoe/allroutes');

// Voucher Routes
const hotspotVouchersRoutes = require('./vouchers/hotspot/allroutes');



const app = express();
const port = 8000;

// Payment Processing
const axios = require('axios');

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

// Clients Routes
app.use(staticClientsRoutes);
app.use(pppoeClientsRoutes);

// Voucher Routes
app.use(hotspotVouchersRoutes);



// Allow requests from any origin
app.use(cors({
    origin: '*',  // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE'],  // Specify allowed methods
    credentials: true,  // Optional: Use this if your requests need to include cookies
}));

// Home route
app.get('/', (req, res) => {
    res.send('Welcome to the Home Page of our Node.js Application!');
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


// Handle Payment Requests
app.use(express.json());

// Middleware for Processing Payment
// Utility function for delay (10 seconds)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to check if CheckoutRequestID exists in the payments table
const checkForPayment = (CheckoutRequestID, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity) => {
    return new Promise((resolve, reject) => {
        // First, check if the payment exists with the given CheckoutRequestID
        db.query('SELECT * FROM payments WHERE CheckoutRequestID = ?', [CheckoutRequestID], (err, results) => {
            if (err) {
                return reject(err);  // Handle the error if something goes wrong
            }
            if (results.length > 0) {
                // If the payment exists, update the relevant fields
                const updatePayment = `
                    UPDATE payments
                    SET company_id = ?, company_username = ?, router_id = ?, router_name = ?,  plan_id = ?, plan_name = ?, plan_validity = ?
                    WHERE CheckoutRequestID = ?
                `;
                db.query(updatePayment, [company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity, CheckoutRequestID], (err, updateResult) => {
                    if (err) {
                        return reject(err);  // Handle update error
                    }
                    resolve(updateResult);  // Resolve the update result
                });
            } else {
                resolve(null);  // Return null if no payment found
            }
        });
    });
};


// POST endpoint: payment-request-pro
app.post('/payment-request-pro', (req, res) => {
    const { amount, phone_number, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity } = req.body;

    // Query the payhero_settings table
    db.query(
        'SELECT callback_url, channel_id, payhero_token FROM payhero_settings WHERE company_id = ?',
        [company_id],
        async (err, results) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Error processing payment request.' });
            }

            if (results.length === 0) {
                return res.status(400).json({ error: "Error processing payment, cannot find payhero settings" });
            }

            const { callback_url, channel_id, payhero_token } = results[0];

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
                const paymentResponse = await axios.post('https://backend.payhero.co.ke/api/v2/payments', paymentPayload, { headers });

                // Extract relevant fields from the response
                const { success, status, reference, CheckoutRequestID } = paymentResponse.data;

                // SQL query to insert the payment response into the paymentrequests table
                const insertPaymentRequest = `
                    INSERT INTO paymentrequests (success, status, reference, CheckoutRequestID, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                `;

                // Insert data into the table
                db.query(insertPaymentRequest, [success, status, reference, CheckoutRequestID, company_id, company_username, router_id, router_name,  plan_id, plan_name, plan_validity], (err, result) => {
                    if (err) {
                        console.error('Failed to insert payment request:', err);
                        return;
                    }
                    console.log('Payment request inserted with ID:', result.insertId);
                });

                if (success && CheckoutRequestID) {
                    let paymentData = null;
                    for (let attempt = 0; attempt < 6; attempt++) {
                        console.log(`Checking payment for CheckoutRequestID: ${CheckoutRequestID}, Attempt: ${attempt + 1}`);

                        // Check for payment in the 'payments' table
                        paymentData = await checkForPayment(CheckoutRequestID, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity);

                        if (paymentData) {
                            const responseData = {
                                success: true,
                                status: paymentData.status,
                                reference: paymentData.reference,
                                CheckoutRequestID: paymentData.CheckoutRequestID
                            };

                            return res.status(200).json({
                                message: 'Payment request processed successfully',
                                data: responseData
                            });
                        }

                        // Wait for 10 seconds before next attempt
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
        }
    );
});



// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
