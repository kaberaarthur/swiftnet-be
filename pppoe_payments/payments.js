const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../dbPromise');
const fs = require('fs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


// Function to check if the payment in pppoe_payments has been entered
// Function to check if CheckoutRequestID exists in the payments table

// Payment check function
const checkForPPPOEPayment = async (
    CheckoutRequestID,
    company_id,
    company_username,
    router_id,
    router_name,
    plan_id,
    phone_number,
    installation_fee
) => {
    try {
        // First, check if the payment exists with the given CheckoutRequestID
        const [results] = await db.query(
            'SELECT * FROM pppoe_payments WHERE CheckoutRequestID = ?',
            [CheckoutRequestID]
        );

        if (results.length > 0) {
            // Log the MpesaReceiptNumber field from the first result row
            const MpesaReceiptNumber = results[0].MpesaReceiptNumber;
            console.log(`MpesaReceiptNumber: ${MpesaReceiptNumber}`);

            // Update the payment if it exists
            const updatePayment = `
                UPDATE pppoe_payments
                SET company_id = ?, company_username = ?, router_id = ?, router_name = ?, 
                    plan_id = ?, phone_number = ?, usedStatus = ?, installation_fee = ?
                WHERE CheckoutRequestID = ?
            `;

            await db.query(updatePayment, [
                company_id,
                company_username,
                router_id,
                router_name,
                plan_id,
                phone_number,
                "used",
                installation_fee,
                CheckoutRequestID
            ]);
            
            return {
                success: true,
                transactionCode: MpesaReceiptNumber // Include voucher or relevant identifier
            };
        } else {
            return {
                success: false,
                message:
                    'We did not receive your payment on time, Contact Admin for Help.',
            };
        }
    } catch (err) {
        console.error(`Database error: ${err.message}`);
        return {
            success: false,
            message: "Database error.",
            error: err.message,
        };
    }
};

// POST endpoint: payment-request-pro
router.post('/pppoe-payment-request-pro', async (req, res) => {
    const { client_id } = req.body;
    console.log("Started Processing Payment: ", client_id);

    try {
        // Query the database to find the user in pppoe_clients with the given phone_number
        const [theClient] = await db.query(
            'SELECT * FROM pppoe_clients WHERE id = ? LIMIT 1',
            [client_id]
        );

        if (theClient && theClient.length > 0){
            const client = theClient[0];
            const phone_number = client.phone_number

            console.log("Found the Client: ", client.full_name);
            // Query the pppoe_plans table for the actual plan details
            const [planResults] = await db.query(
                'SELECT plan_validity, plan_name, router_id FROM pppoe_plans WHERE id = ?',
                [Number(client.plan_id)]
            );

            if (planResults.length === 0) {
                return res.status(400).json({ message: "Error processing payment, cannot find the specified plan." });
            } 

            // Destructure the necessary fields from the plan query results
            const { plan_validity, plan_name, router_id } = planResults[0];

            let amount = Number(client.plan_fee) + Number(client.installation_fee);

            // Query the payhero_settings table
            const [payheroResults] = await db.query(
                'SELECT pppoe_callback_url, channel_id, payhero_token FROM payhero_settings WHERE company_id = ?',
                [client.company_id]
            );

            if (payheroResults.length === 0) {
                return res.status(400).json({ error: "Error processing payment, cannot find payhero settings" });
            } else {
                console.log("Payhero Settings Found...")
            }

            const { pppoe_callback_url, channel_id, payhero_token } = payheroResults[0];

            const paymentPayload = {
                amount,
                phone_number: client.phone_number,
                channel_id: Number(channel_id),
                provider: "m-pesa",
                external_reference: "INV-009",
                customer_name: client.full_name,
                callback_url: pppoe_callback_url
            };

            // Write payload to a text file
            fs.writeFileSync("payment_payload.txt", JSON.stringify(paymentPayload, null, 4));

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `${payhero_token}`
            };
        
            // Make a POST request to the external payment service
            const paymentResponse = await axios.post(
                'https://backend.payhero.co.ke/api/v2/payments',
                paymentPayload,
                { headers }
            );

            const { success, status, reference, CheckoutRequestID } = paymentResponse.data;

            // SQL query to insert the payment response into the payment_requests table
            const insertPaymentRequest = `
            INSERT INTO pppoe_payment_requests (success, status, reference, CheckoutRequestID, company_id, company_username, router_id, plan_id, plan_name, phone_number, installation_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `;

            await db.query(insertPaymentRequest, [
            success, status, reference, CheckoutRequestID,
            client.company_id, client.company_username, client.router_id,
            Number(client.plan_id), client.plan_name, client.phone_number, client.installation_fee
            ]);

            if (success && CheckoutRequestID) {
                let paymentData = null;
                let endDate; // Declare endDate in a wider scope

                for (let attempt = 0; attempt < 6; attempt++) {
                    console.log(`Checking payment for CheckoutRequestID: ${CheckoutRequestID}, Attempt: ${attempt + 1}`);

                    // Check for payment in the 'payments' table
                    paymentData = await checkForPPPOEPayment(
                        CheckoutRequestID, client.company_id, client.company_username,
                        client.router_id, 'Router Name', Number(client.plan_id),
                        client.phone_number, client.installation_fee
                    );

                    // Update user profile with new plan details
                    if (paymentData.success) {
                        try {                          
                            if (client) {
                                console.log(client)
                                // User found, Calculate the new expiry date base on whether the plan has already expired or not.

                                const startDate = new Date(); // Current timestamp
                                const daysToAdd = 30; // Number of days to add
                                const current_endDate = client.end_date ? new Date(client.end_date) : null; 
                                // Check if the current_endDate is in the past

                                if (current_endDate && current_endDate < startDate) {
                                    // If the current_endDate is past, add 30 days to startDate
                                    endDate = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                                    console.log("Renewing after expiry: ", endDate);
                                } else if (current_endDate) {
                                    // If the current_endDate is not past, add 30 days to current_endDate
                                    endDate = new Date(current_endDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                                    console.log("Renewing before expiry: ", endDate);
                                } else {
                                    endDate = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                                    console.log("New Client: ", endDate);
                                }

                                const installation_fee = 0;

                                // Update the user's record in pppoe_clients
                                // Step 1: Fetch the first record based on phone_number
                                const [rows] = await db.query(
                                    `SELECT id FROM pppoe_clients WHERE phone_number = ? ORDER BY id ASC LIMIT 1`,
                                    [phone_number]
                                );

                                // Step 2: Check if a record exists
                                if (rows.length > 0) {
                                    const clientId = rows[0].id; // Pick the first record's ID
                                    console.log("Client found: ", clientId);

                                    // Step 3: Update only that record
                                    await db.query(
                                        `
                                        UPDATE pppoe_clients
                                        SET start_date = ?, updated_at = ?, end_date = ?, plan_name = ?, installation_fee = ?
                                        WHERE id = ?
                                        `,
                                        [startDate, startDate, endDate, plan_name, installation_fee, clientId]
                                    );

                                    console.log(`Updated record with ID: ${clientId}`);

                                    // Return success response with new end date
                                    return res.status(200).json({
                                        message: 'Your payment has been processed successfully',
                                        new_end_date: String(endDate),
                                    });
                                } else {
                                    console.log("No matching record found for phone number:", phone_number);
                                    return res.status(404).json({
                                        message: 'No matching client found',
                                    });
                                }
                            } else {
                                console.error(`No user found with phone_number ${phone_number}`);
                                return res.status(404).json({
                                    error: 'User not found'
                                });
                            }
                        } catch (err) {
                            console.error('Error updating user in PPPoE Clients:', err);
                            return res.status(500).json({
                                error: 'Failed to update user details. Contact Admin for Help!'
                            });
                        }
                    }

                    // Wait for 10 seconds before the next attempt
                    await delay(10000);
                }

                // If no payment record is found after 6 tries, return failure
                return res.status(400).json({
                    status: 'failure',
                    success: false,
                    message: 'Payment not found after multiple attempts.'
                });
            } else {
                // Handle case where the initial payment request fails
                return res.status(400).json({
                    status: 'failure',
                    success: false,
                    message: paymentResponse.data.error_message || 'Payment request failed.'
                });
            }
        } else {
            // No client found with the given ID
            return res.status(404).json({
                status: 'failure',
                success: false,
                message: 'Client not found'
            });
        }
    } catch (err) {
        console.error('Error querying database:', err);
        return res.status(500).json({ 
            status: 'failure',
            success: false,
            error: 'Error processing payment request.', 
            errorDetails: err.message || err 
        });
    }
});

// To Process the callback response
// Create operation - to store the response data
router.post('/pppoe-payments', (req, res) => {
    const { response } = req.body;

    // console.log("Callback Body: ", response)

    // Extracting the relevant fields from the response
    const {
        Amount,
        CheckoutRequestID,
        ExternalReference,
        MerchantRequestID,
        MpesaReceiptNumber,
        Phone,
        ResultCode,
        ResultDesc,
        Status
    } = response;

    // SQL query to insert the response data into the 'payments' table
    const query = `
        INSERT INTO pppoe_payments (Amount, CheckoutRequestID, ExternalReference, MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode, ResultDesc, Status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Use promise-based query handling
    db.query(query, [Amount, CheckoutRequestID, ExternalReference, MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode, ResultDesc, Status])
        .then(result => {
            res.status(201).json({ message: 'Payment data saved successfully and voucher created' });
        })
        .catch(err => {
            console.error('Error saving payment:', err);
            // Send detailed error response
            res.status(200).json({ error: 'Failed to save payment data', details: err.message || err });
        });
});

// GET endpoint to retrieve PPPoE payments with optional filters
router.get('/pppoe-payments', async (req, res) => {
    const { company_id, router_id, phone_number } = req.query;

    try {
        // Base query
        let query = 'SELECT * FROM pppoe_payments WHERE 1=1';
        const params = [];

        // Apply filters dynamically
        if (company_id) {
            query += ' AND company_id = ?';
            params.push(company_id);
        }

        if (router_id) {
            query += ' AND router_id = ?';
            params.push(router_id);
        }

        if (phone_number) {
            query += ' AND phone_number = ?';
            params.push(phone_number);
        }

        // Execute the query
        const [results] = await db.query(query, params);

        // Send the response
        res.status(200).json(results);
    } catch (err) {
        console.error('Error retrieving payments:', err);
        res.status(500).json({ error: 'An error occurred while fetching PPPoE payments.' });
    }
});

// GET endpoint to retrieve PPPoE payments with optional filters
router.get('/customer-payments', async (req, res) => {
    const { customer_id, portal_password } = req.query;

    if(!customer_id) {
        res.status(400).json({message: "Error Accessing Resource"});
    }

    try {
        // Base query
        let query = 'SELECT * FROM pppoe_payments WHERE 1=1';
        const params = [];

        if (customer_id) {
            query += ' AND customer_id = ?';
            params.push(customer_id);
        }

        if (portal_password) {
            console.log("Portal Password: ", portal_password);
        }

        // Execute the query
        const [results] = await db.query(query, params);

        // Send the response
        res.status(200).json(results);
    } catch (err) {
        console.error('Error retrieving payments:', err);
        res.status(500).json({ error: 'An error occurred while fetching PPPoE payments.' });
    }
});

module.exports = router;