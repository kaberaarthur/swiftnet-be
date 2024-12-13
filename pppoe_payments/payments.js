const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../dbPromise');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


// Function to check if the payment in pppoe_payments has been entered
// Function to check if CheckoutRequestID exists in the payments table
const checkForPPPOEPayment = async (
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
    payment_type,
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
                SET company_id = ?, company_username = ?, router_id = ?, router_name = ?, plan_id = ?, plan_name = ?, plan_validity = ?, mac_address = ?, phone_number = ?, usedStatus = ?, payment_type = ?, installation_fee = ?
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
                payment_type,
                CheckoutRequestID,
                installation_fee
            ]);
            

            // Update the PPPOE Clients row here
            return {
                status: 200,
                message: 'Payment received successfully',
                transactionCode: MpesaReceiptNumber // Include voucher or relevant identifier
            };
            
            
        } else {
            return {
                status: 400,
                message:
                    'We did not receive your payment on time, Contact Admin for Help.',
            };
        }
    } catch (err) {
        console.error(`Database error: ${err.message}`);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
    }
    
};

// POST endpoint: payment-request-pro
router.post('/pppoe-payment-request-pro', async (req, res) => {
    const { phone_number, company_id, company_username, router_id, router_name, plan_id, mac_address, payment_type, installation_fee } = req.body;

    try {
        // Query the pppoe_plans table for the actual plan details
        const [planResults] = await db.query(
            'SELECT plan_price, plan_validity, plan_name, router_id, type, rate_limit_string FROM pppoe_plans WHERE id = ?',
            [plan_id]
        );

        if (planResults.length === 0) {
            return res.status(400).json({ message: "Error processing payment, cannot find the specified plan." });
        }

        // Destructure the necessary fields from the plan query results
        const { plan_price, plan_validity, plan_name, router_id, type, rate_limit_string } = planResults[0];
        let amount = Math.floor(plan_price); // Assign plan_price to amount

        if ( installation_fee > 0 ) {
            amount = Math.floor(plan_price + installation_fee)
        };

        // Query the payhero_settings table
        const [payheroResults] = await db.query(
            'SELECT pppoe_callback_url, channel_id, payhero_token FROM payhero_settings WHERE company_id = ?',
            [company_id]
        );

        if (payheroResults.length === 0) {
            return res.status(400).json({ error: "Error processing payment, cannot find payhero settings" });
        }

        const { pppoe_callback_url, channel_id, payhero_token } = payheroResults[0];


        const paymentPayload = {
            amount,
            phone_number,
            channel_id: Number(channel_id),
            provider: "m-pesa",
            external_reference: "INV-009",
            pppoe_callback_url
        };

        // console.log("Payment Payload: ", paymentPayload);

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
                INSERT INTO pppoe_payment_requests (success, status, reference, CheckoutRequestID, company_id, company_username, router_id, router_name, plan_id, plan_name, plan_validity, mac_address, phone_number, payment_type, installation_fee)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            `;

            await db.query(insertPaymentRequest, [
                success, status, reference, CheckoutRequestID,
                company_id, company_username, router_id, router_name,
                plan_id, plan_name, plan_validity, mac_address, phone_number, payment_type, installation_fee
            ]);

            if (success && CheckoutRequestID) {
                let paymentData = null;
                for (let attempt = 0; attempt < 6; attempt++) {
                    console.log(`Checking payment for CheckoutRequestID: ${CheckoutRequestID}, Attempt: ${attempt + 1}`);

                    // Check for payment in the 'payments' table
                    paymentData = await checkForPPPOEPayment(
                        CheckoutRequestID, company_id, company_username,
                        router_id, router_name, plan_id, plan_name,
                        plan_validity, mac_address, phone_number, payment_type, installation_fee
                    );


                    // Update user profile with new plan details
                    if (paymentData) {
                        try {
                            // Query the database to find the user in pppoe_clients with the given phone_number
                            const [client] = await db.query(
                                'SELECT * FROM pppoe_clients WHERE phone_number = ? LIMIT 1',
                                [phone_number]
                            );
                    
                            if (client.length > 0) {
                                // User found, calculate the new end_date based on plan_validity
                                const startDate = new Date(); // Current timestamp
                                const endDate = new Date(startDate.getTime() + plan_validity * 60 * 60 * 1000); 

                                // Update the user's record in pppoe_clients
                                await db.query(
                                    `
                                    UPDATE pppoe_clients
                                    SET start_date = ?, updated_at = ?, end_date = ?, plan_name = ?
                                    WHERE phone_number = ?
                                    `,
                                    [startDate, startDate, endDate, plan_name, phone_number]
                                );
                    
                                console.log(`User with phone_number ${phone_number} updated successfully.`);
                            } else {
                                console.error(`No user found with phone_number ${phone_number}`);
                            }
                    
                            return res.status(200).json({
                                message: 'Your payment has been processed successfully'
                            });
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

// To Process the callback response
// Create operation - to store the response data
router.post('/pppoe-payments', (req, res) => {
    const { response } = req.body;

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

module.exports = router;