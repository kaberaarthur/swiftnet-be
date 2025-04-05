// smsSender.js
const db = require('../../dbPromise');
const axios = require('axios');

// Static credentials and constants
const API_KEY = 'atsk_9cfc317182ef7086d1c0c7c4445f2a95fa4578a005917a45f5b9921539ae0fd1cde536d2';
const USERNAME = 'Swiftnet_sms';
const SENDER_ID = 'SwiftKenya';

/**
 * Send an OTP SMS to a client and update it in the database
 * @param {number} clientId - ID of the client in the database
 * @param {string|string[]} phoneNumbers - Phone number(s) to send the message to
 * @param {string|null} maskedNumber - Optional masked number
 * @param {string|null} telco - Optional telco
 */
async function sendSMS(clientId, phoneNumbers, maskedNumber = null, telco = null) {
  if (typeof phoneNumbers === 'string') {
    phoneNumbers = [phoneNumbers];
  }

  // Generate random 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000);

  // Build message
  const message = `Your verification code is ${otp}. It expires in 5 minutes.`;

  // Update OTP in database
  try {
    const [updateResult] = await db.execute(
      'UPDATE pppoe_clients SET otp = ? WHERE id = ?',
      [otp, clientId]
    );

    if (updateResult.affectedRows === 0) {
      console.warn(`No client found with ID ${clientId} to update OTP.`);
    } else {
      console.log(`OTP ${otp} updated for client ID ${clientId}.`);
    }
  } catch (err) {
    console.error('Database error while updating OTP:', err);
    throw err;
  }

  const url = 'https://api.africastalking.com/version1/messaging/bulk';

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apiKey: API_KEY,
  };

  const payload = {
    username: USERNAME,
    message,
    senderId: SENDER_ID,
    phoneNumbers,
  };

  if (maskedNumber) payload.maskedNumber = maskedNumber;
  if (telco) payload.telco = telco;

  console.log('Sending OTP SMS:', message);
  console.log('Phone Numbers:', phoneNumbers);

  try {
    const response = await axios.post(url, payload, { headers });
    console.log('SMS Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    throw error;
  }
}

module.exports = { sendSMS };
