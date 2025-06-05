const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const axios = require('axios');
const moment = require('moment-timezone');

// Initiates STK Push via PayHero
async function initiateSTKPush(phone_number, company_id) {
  if (!phone_number || !company_id) {
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

    // Make the request
    const response = await axios.post('https://backend.payhero.co.ke/api/v2/payments', payload, { headers });

    return {
      success: true,
      message: 'STK push initiated successfully.',
      data: response.data
    };
  } catch (error) {
    console.error('Error during STK push:', error?.response?.data || error.message);
    return {
      success: false,
      message: 'Failed to initiate STK push',
      error: error?.response?.data || error.message
    };
  }
}

module.exports = { initiateSTKPush };
