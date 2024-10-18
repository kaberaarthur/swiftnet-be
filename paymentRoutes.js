const express = require('express');
const router = express.Router();
const db = require('./db');

// Function to parse Python-like dictionary string
function parsePythonLikeDict(str) {
    // Remove leading and trailing spaces
    str = str.trim();
    // Remove the curly braces
    str = str.slice(1, -1);
    // Split the string into key-value pairs
    const pairs = str.split(',').map(pair => pair.trim());
    // Create an object from the pairs
    const obj = {};
    for (let pair of pairs) {
        const [key, value] = pair.split(':').map(item => item.trim());
        // Remove quotes from the key
        const cleanKey = key.replace(/['"]/g, '');
        // Parse the value
        let cleanValue;
        if (value === 'True') cleanValue = true;
        else if (value === 'False') cleanValue = false;
        else if (value.startsWith("'") || value.startsWith('"')) cleanValue = value.slice(1, -1);
        else cleanValue = value;
        obj[cleanKey] = cleanValue;
    }
    return obj;
}



// Create operation - to store the payment request data
// To store the response gotten immediately after the stk request has been made
// NOT the callback response
router.post('/payment-request', (req, res) => {
    let response;

    try {
        // Check if the response is already a JSON object
        if (typeof req.body === 'object' && !Array.isArray(req.body)) {
            response = req.body;
        } else if (typeof req.body === 'string') {
            // If it's a string, try to parse it as a Python-like dictionary
            response = parsePythonLikeDict(req.body);
        } else {
            throw new Error('Invalid input format');
        }

        // Extracting the relevant fields from the response
        const {
            success,
            status,
            reference,
            CheckoutRequestID
        } = response;

        // Convert 'success' to 1 for True and 0 for False
        const successValue = success ? 1 : 0;

        // SQL query to insert the response data into the 'paymentRequests' table
        const query = `
            INSERT INTO paymentrequests (success, status, reference, CheckoutRequestID)
            VALUES (?, ?, ?, ?)
        `;

        db.query(query, [successValue, status, reference, CheckoutRequestID], (err, result) => {
            if (err) {
                console.error('Error saving payment request:', err);
                return res.status(500).json({ error: 'Failed to save payment request data' });
            }

            res.status(201).json({ message: 'Payment request data saved successfully' });
        });
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(400).json({ error: 'Invalid request format' });
    }
});


// To Process the callback response
// Create operation - to store the response data
router.post('/payment', (req, res) => {
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
        INSERT INTO payments (Amount, CheckoutRequestID, ExternalReference, MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode, ResultDesc, Status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(query, [Amount, CheckoutRequestID, ExternalReference, MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode, ResultDesc, Status], (err, result) => {
        if (err) {
            console.error('Error saving payment:', err);
            return res.status(500).json({ error: 'Failed to save payment data' });
        }

        res.status(201).json({ message: 'Payment data saved successfully' });

        // I need to create a Voucher here

    });
});

// Read operation - to fetch the saved response data
router.get('/payments', (req, res) => {
    // SQL query to retrieve all the payment records
    const query = 'SELECT * FROM payments';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching payments:', err);
            return res.status(500).json({ error: 'Failed to fetch payments data' });
        }

        res.status(200).json(results);
    });
});

// Endpoint to check transaction
router.post('/check-transaction', (req, res) => {
    // Get the MpesaReceiptNumber from the request body
    const { mpesaReceiptNumber } = req.body;

    if (!mpesaReceiptNumber) {
        return res.status(200).json({ status: 'failure', message: 'MpesaReceiptNumber is required' });
    }

    // SQL query to find the CheckoutRequestID from payments table
    const findCheckoutRequestIDQuery = `
        SELECT CheckoutRequestID
        FROM payments
        WHERE MpesaReceiptNumber = ?
    `;

    db.query(findCheckoutRequestIDQuery, [mpesaReceiptNumber], (err, results) => {
        if (err) {
            console.error('Error finding CheckoutRequestID:', err);
            return res.status(200).json({ status: 'failure', message: 'Failed to retrieve CheckoutRequestID' });
        }

        if (results.length === 0) {
            return res.status(200).json({ status: 'failure', message: 'No matching record found in payments table' });
        }

        const { CheckoutRequestID } = results[0];

        // SQL query to find the reference from paymentrequests table
        const findReferenceQuery = `
            SELECT reference
            FROM paymentrequests
            WHERE CheckoutRequestID = ?
        `;

        db.query(findReferenceQuery, [CheckoutRequestID], (err, results) => {
            if (err) {
                console.error('Error finding reference:', err);
                return res.status(200).json({ status: 'failure', message: 'Failed to retrieve reference' });
            }

            if (results.length === 0) {
                return res.status(200).json({ status: 'failure', message: 'No matching record found in paymentrequests table' });
            }

            const { reference } = results[0];
            res.status(200).json({ status: 'success', message: 'Transaction found successfully', reference });
        });
    });
});


module.exports = router;
