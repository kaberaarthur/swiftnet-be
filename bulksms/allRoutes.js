const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    const bearerToken = token.split(' ')[1];
    
    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.companyId = decoded.company_id;
        next();
    });
}

// Function to send one sms
async function sendSmsViaAfricastalking({ apiKey, username, senderId, message, phone }) {
  try {
    const payload = {
      username: username,
      message: message,
      senderId: senderId,
      phoneNumbers: [phone],
    };

    const response = await axios.post(
      'https://api.africastalking.com/version1/messaging/bulk',
      payload,
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'apiKey': apiKey
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error(`Error sending SMS to ${phone}:`, error.response?.data || error.message);
    throw error;
  }
};

// POST /sms/send
router.post('/send', verifyToken, async (req, res) => {
  const companyId = req.companyId;

  const [rows] = await db.execute(
    `SELECT * FROM companies WHERE id = ? LIMIT 1`,
    [companyId]
  );

  if (rows.length > 0) {
    console.log(rows[0].africas_talking_sender_id);
  } else {
    return res.status(403).json({ 
        message: "We don't know who you represent" 
    });
  }
  
  // Ensure only admin/superadmin can proceed
  // Design a Special Permission for Bulk SMS.
  /*
  if (req.userType !== 'admin' && req.userType !== 'superadmin') {
    return res.status(403).json({ 
      message: 'Access denied: Admin privileges required' 
    });
  }
    */

  try {
    const data = req.body;

    // Check if data is an array (multiple messages)
    if (!Array.isArray(data)) {
      return res.status(400).json({ message: 'Expected an array of message objects.' });
    }

    // Validate all rows have matching company_id
    const mismatch = data.find(item => item.company_id !== companyId);

    if (mismatch) {
      return res.status(400).json({ 
        message: 'Request could not be completed.' 
      });
    }

    // Send the SMS'es here
    const company = rows[0];
    const sendResults = [];
    let successCount = 0;
    let failureCount = 0;

    for (const item of data) {
      try {
          const response = await sendSmsViaAfricastalking({
              apiKey: company.africas_talking_key,
              username: company.africas_talking_username,
              senderId: company.africas_talking_sender_id,
              message: item.sms,
              phone: item.phone.trim(),
          });

          // console.log(response["SMSMessageData"]["Recipients"][0]["statusCode"]);

          const recipient = response["SMSMessageData"]["Recipients"][0];
          const smsStatusCode = parseInt(response["SMSMessageData"]["Recipients"][0]["statusCode"]);
          const isSuccess = smsStatusCode < 103;

          // console.log(`Sent to : ${item.phone.trim()}`, isSuccess);

          if (isSuccess) successCount++;
          else failureCount++;

          sendResults.push({
              id: item.id,
              phone: item.phone,
              status: isSuccess ? 'success' : 'failed',
              africasTalkingResponse: recipient
          });
      } catch (err) {
              failureCount++;
              sendResults.push({
              id: item.id,
              phone: item.phone,
              status: 'failed',
              error: err.message
          });
      }
    };


    // Insert a log for Bulk SMS'es sent
    await db.execute(
        `INSERT INTO bulk_sms_logs (company_id, user_id, user_type, total_messages, log_data)
        VALUES (?, ?, ?, ?, ?)`,
        [companyId, req.userId, req.userType, data.length, JSON.stringify(data)]
    );

    // Respond with detailed result
    res.status(200).json({
        message: 'SMS dispatch complete',
        summary: {
            total: data.length,
            success: successCount,
            failed: failureCount
        },
        // results: sendResults
    });

  } catch (err) {
    console.error("Error handling SMS post:", err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
