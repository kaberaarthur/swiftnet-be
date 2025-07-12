const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const axios = require('axios');
const moment = require('moment-timezone');
const base64 = require('base-64');


const userFunctions = require('./userFunctions');
const { generatePassword } = require('./actionFunctions');
const createOrUpdateUser = userFunctions.createOrUpdateUser;

// STK PUSH Code for Hotspot
const consumerKey = process.env.DARAJA_CONSUMER_KEY;
const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
const swiftnetShortcode = process.env.SWIFTNET_MPESA_SHORTCODE;
const swiftnetPasskey = process.env.DARAJA_PASSKEY;
const darajaTimestamp = moment().tz('Africa/Nairobi').format('YYYYMMDDHHmmss');
const coreURL = process.env.PROD_BASE_URL

const stringToEncode = swiftnetShortcode + swiftnetPasskey + darajaTimestamp;
const encodedPassword = Buffer.from(stringToEncode, 'utf8').toString('base64');
// console.log(`Encoded Password (Node.js Base64): ${encodedPassword}`);

// ACCESS TOKEN URL
const access_token_url = 'https://api.safaricom.co.ke/oauth/v2/generate?grant_type=client_credentials';

async function getAccessToken() {
    const credentials = `${consumerKey}:${consumerSecret}`;
    const encodedCredentials = base64.encode(credentials);

    const headers = {
        Authorization: `Basic ${encodedCredentials}`
    };

    try {
        const response = await axios.get(access_token_url, { headers });

        return {
          access_token: response.data.access_token,
          timestamp: darajaTimestamp
        }
    } catch (error) {
        console.error("Failed to get access token.");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        } else {
            console.error("Error:", error.message);
        }
        return null;
    }
}

// Intiates STK Push Directly Through Daraja
async function initiateDarajaStkPush(myPhoneNumber, planPrice) {
    const accessData = await getAccessToken();
    if (!accessData || !accessData.access_token) {
        console.error("Failed to initiate STK Push due to missing token.");
        return null;
    }

    const accessToken = accessData.access_token;

    const stkHeaders = {
        Authorization: `Bearer ${accessToken}`
    };

    const stkPayload = {
        "BusinessShortCode": swiftnetShortcode,
        "Password": encodedPassword,
        "Timestamp": darajaTimestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": planPrice,
        "PartyA": myPhoneNumber,
        "PartyB": swiftnetShortcode,
        "PhoneNumber": myPhoneNumber,
        "CallBackURL": coreURL + "/hotspot-mpesa/daraja-callback",
        "AccountReference": "Hotspot",
        "TransactionDesc": "Payment of X"
    };

    try {
        const response = await axios.post(
            'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
            stkPayload,
            { headers: stkHeaders }
        );

        console.log("STK Push response:", response.data);
        return response.data;
    } catch (error) {
        console.error("STK Push failed.");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        } else {
            console.error("Error:", error.message);
        }
        return null;
    }
}


// Initiates STK Push via PayHero
// Include a plan_id
async function initiateSTKPush(phone_number, company_id, plan_id) {
  if (!phone_number || !company_id || !plan_id) {
    return { success: false, message: 'phone_number and company_id are required' };
  }

  try {
    // Fetch payhero settings for the company
    const [rows] = await db.execute(
      'SELECT * FROM payhero_settings WHERE company_id = ? AND status = ? LIMIT 1',
      [company_id, 'active']
    );

    if (rows.length === 0) {
      return { success: false, message: 'Active PayHero settings not found for this company.' };
    }

    const settings = rows[0];

    // Fetch plan details
    const [planRows] = await db.execute(
      'SELECT * FROM hotspot_plans WHERE id = ? LIMIT 1',
      [plan_id]
    );

    if (planRows.length === 0) {
      return { success: false, message: 'This plan does not exist.' };
    }

    const plan = planRows[0];

    // Payload for the STK push
    const payload = {
      amount: 1, // Can be made dynamic
      phone_number: phone_number,
      channel_id: settings.channel_id,
      provider: 'm-pesa',
      external_reference: `INV-${Date.now()}`,
      customer_name: 'Arthur Kabera', // You can change this to actual name if available
      callback_url: settings.callback_url || 'https://example.com/callback'
    };

    // HTTP headers with authorization
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `${settings.payhero_token}`
    };

    // Make the stk push request
    const response = await axios.post('https://backend.payhero.co.ke/api/v2/payments', payload, { headers });

    const resData = response.data;

    // Store in `paymentrequests` table
    await db.execute(
        `INSERT INTO paymentrequests 
            (phone_number, plan_id, company_id, CheckoutRequestID, reference, 
            status, success, company_username, router_id, plan_name, plan_validity) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            phone_number,
            plan_id,
            company_id,
            resData.CheckoutRequestID,
            resData.reference,
            resData.status,
            resData.success,
            plan.company_username,
            plan.router_id,
            plan.plan_name,
            plan.plan_validity
        ]
    );

    console.log("Checkout Request ID: ", resData.CheckoutRequestID);

    // Check if we received payment from payhero
    try {
            const responseFromAPI = await axios.post(
                'http://localhost:8000/hotspot-mpesa/find-payment',
                { checkoutRequestID: resData.CheckoutRequestID }
            );

            const result = responseFromAPI.data;

            if (!result.success) {
                return {
                success: false,
                message: 'STK push initiated but payment could not be verified.',
                data: result
                };
            }

            // Calculate service_start and service_expiry using UTC+3
            const serviceStart = moment().tz('Africa/Nairobi');
            const serviceExpiry = moment(serviceStart).add(plan.plan_validity, 'hours');
        
            const formattedStart = serviceStart.format('YYYY-MM-DD HH:mm:ss');
            const formattedExpiry = serviceExpiry.format('YYYY-MM-DD HH:mm:ss');

            // ✅ Update the payments row with additional info from the plan
            await db.execute(
                `UPDATE payments 
                SET company_username = ?, 
                    router_id = ?, 
                    plan_name = ?, 
                    plan_validity = ?,
                    plan_id = ?,
                    company_id = ?,
                    phone_number = ?,
                    start_date = ?,
                    end_date = ?
                WHERE id = ?`,
                [
                plan.company_username,
                plan.router_id,
                plan.plan_name,
                plan.plan_validity,
                plan.id,
                plan.company_id,
                phone_number,
                formattedStart,
                formattedExpiry,
                result.data.id // ID from the found payment row
                ]
            );

            // Get user
            const [users] = await db.execute(
                'SELECT * FROM hotspot_clients WHERE phone_number = ? LIMIT 1',
                [phone_number]
            );

            if (users.length === 0) {
                // Create user ifnotexists, update user
                const newPassword = generatePassword();
                console.log("New User, New Password: ", newPassword);

                // Call createOrUpdateUser
                const userCreationResult = await createOrUpdateUser({
                    phone_number,
                    router_id: plan.router_id,
                    plan_id: plan.id,
                    password: newPassword // This 'password' is the one passed into createOrUpdateUser for new users
                });

                // Check if the user creation/update was successful
                if (!userCreationResult.success) {
                    return res.status(500).json({
                        success: false,
                        message: userCreationResult.message || 'Failed to create or update user.'
                    });
                }

                // Use the password returned from createOrUpdateUser
                const finalPassword = userCreationResult.userPassword;

                // ✅ Respond after successful user creation
                return {
                    success: true,
                    message: 'STK push initiated and payment verified.',
                    data: {
                        user: {
                            "username": phone_number,
                            "password": finalPassword,
                        },
                        stkResponse: response.data,
                        payment: result.data,
                    }
                };
            }

            const thisUser = users[0];

            // ✅ Respond after successful update
            return {
                success: true,
                message: 'STK push initiated and payment verified.',
                data: {
                    user: {
                        "username": phone_number,
                        "password": thisUser.password,
                    },
                    stkResponse: response.data,
                    payment: result.data,
                }
            };
        } catch (apiError) {
            console.error("API Error:", apiError.response?.data || apiError.message);
            return {
                success: false,
                message: 'Failed to verify payment after STK push.',
                error: apiError.response?.data || apiError.message
            };
        }

  } catch (error) {
    console.error('Error during STK push:', error?.response?.data || error.message);
    return {
      success: false,
      message: 'Failed to initiate STK push',
      error: error?.response?.data || error.message
    };
  }
}


async function confirmPaymentByTransactionCode(transactionCode, router_id) {
  if (!transactionCode || !router_id) {
    return { success: false, message: 'You must provide all parameters' };
  }

  try {
    const [rows] = await db.execute(
      'SELECT * FROM payments WHERE MpesaReceiptNumber = ? AND router_id = ? LIMIT 1',
      [transactionCode, router_id]
    );

    if (rows.length === 0) {
      return { success: false, message: 'Cannot connect. Mpesa transaction not found.' };
    }

    const payment = rows[0];


    // Parse end_date and get current time in Nairobi
    const currentTimeNairobi = moment.tz('Africa/Nairobi');
    const endDate = moment.tz(payment.end_date, 'Africa/Nairobi');

    if (endDate.isBefore(currentTimeNairobi)) {
      return {
        success: false,
        message: 'Cannot connect. Time for this payment has expired.'
      };
    }

    // Get user
    const [users] = await db.execute(
      'SELECT * FROM hotspot_clients WHERE phone_number = ? LIMIT 1',
      [payment.Phone]
    );

    if (users.length === 0) {
      return { success: false, message: 'Cannot connect. User could not be traced.' };
    }

    const thisUser = users[0];

    return {
      success: true,
      message: 'Reconnect approved.',
      username: thisUser.phone_number,
      password: thisUser.password,
      data: payment,
    };
  } catch (error) {
    console.error('Error in confirmPaymentByTransactionCode:', error.message);
    return { success: false, message: 'Internal server error.' };
  }
}


async function findPaymentByCheckoutRequestID(checkoutRequestID) {
  if (!checkoutRequestID) {
    return { success: false, message: 'CheckoutRequestID is required.' };
  }

  const maxAttempts = 60;
  const delay = 1000; // 1 second

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const [rows] = await db.execute(
        'SELECT * FROM payments WHERE CheckoutRequestID = ? LIMIT 1',
        [checkoutRequestID]
      );

      if (rows.length > 0) {
        return {
          success: true,
          message: 'Payment found.',
          data: rows[0]
        };
      }

      if (attempt < maxAttempts) {
        await wait(delay);
      }

    } catch (error) {
      console.error(`Error on attempt ${attempt}:`, error.message);
      return { success: false, message: 'Database error.', error: error.message };
    }
  }

  return { success: false, message: 'Payment not found after 10 seconds.' };
}

module.exports = { 
    initiateSTKPush,
    confirmPaymentByTransactionCode,
    findPaymentByCheckoutRequestID,
    getAccessToken,
    initiateDarajaStkPush
};
