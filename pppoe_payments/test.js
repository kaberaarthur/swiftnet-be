const express = require('express');
const router = express.Router();
const db = require('../dbPromise'); 
const axios = require('axios');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// payment_type, mac_address, plan_validity, plan_name
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
            SET company_id = ?, company_username = ?, router_id = ?, router_name = ?, plan_id = ?, phone_number = ?, usedStatus = ?, installation_fee = ?
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
            

            // Update the PPPOE Clients row here
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
router.post('/pppoe-payment-test', async (req, res) => {
    const { client_id } = req.body;
    // console.log("Started Processing Payment: ", client_id);

    try {
        // Query the database to find the user in pppoe_clients with the given client_id
        const [theClient] = await db.query(
            'SELECT * FROM pppoe_clients WHERE id = ? LIMIT 1',
            [client_id]
        );

        // Check if client was found
        if (theClient && theClient.length > 0) {
            const client = theClient[0]

            plan_id = parseInt(client.plan_id, 10);

            const [planResults] = await db.query(
                'SELECT plan_validity, plan_name, router_id FROM pppoe_plans WHERE id = ?',
                [plan_id]
            );

            if (planResults.length === 0) {
                return res.status(400).json({ message: "Error processing payment, cannot find the specified plan." });
            }

            const {  plan_validity, plan_name, router_id } = planResults[0];

            const [payheroResults] = await db.query(
                'SELECT pppoe_callback_url, channel_id, payhero_token FROM payhero_settings WHERE company_id = ?',
                [client.company_id]
            );

            if (payheroResults.length === 0) {
                return res.status(400).json({ error: "Error processing payment, cannot find payhero settings" });
            }

            const { pppoe_callback_url, channel_id, payhero_token } = payheroResults[0];

            const amount = Number(client.plan_fee) + Number(client.installation_fee)

            const paymentPayload = {
                amount,
                phone_number: client.phone_number,
                channel_id: Number(channel_id),
                provider: "m-pesa",
                external_reference: "INV-009",
                customer_name: client.full_name,
                callback_url:pppoe_callback_url
            };

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `${payhero_token}`
            };
        
            // Make a POST request to the external payment service
            /** */
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
            plan_id, client.plan_name, client.phone_number, client.installation_fee
            ]);

            if (success && CheckoutRequestID) {
                let paymentData = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    console.log(`Checking payment for CheckoutRequestID: ${CheckoutRequestID}, Attempt: ${attempt + 1}`);

                    // Check for payment in the 'payments' table
                    paymentData = await checkForPPPOEPayment(
                        CheckoutRequestID, client.company_id, client.company_username,
                        client.router_id, plan_id, client.plan_name,
                        client.phone_number, client.installation_fee
                    );


                    // Update user profile with new plan details
                    if (paymentData.success) {
                        console.log("Checking for PPPoE payment worked!");
                    }

                    // Wait for 10 seconds before the next attempt
                    await delay(5000);
                }
            }

            return res.status(200).json({
                message: 'Your payment has been processed successfully'
            });
            
            /**/
        } else {
            console.log("Client not found");
            res.status(404).json({ message: "Client not found" });
        }
    } catch (error) {
        console.error("An Error Occurred:", error);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
