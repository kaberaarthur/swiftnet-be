const express = require('express');
const router = express.Router();
const db = require('../dbPromise'); // Change to use `db` instead of `dbPromise`
const { Client } = require('ssh2');
const e = require('express');
const moment = require('moment-timezone');

const { generatePassword, generateUniqueVoucher, createVoucher, verifyToken, deleteOldRedeemedVouchers } = require('./actionFunctions');
const userFunctions = require('./userFunctions');
const fetchUser = userFunctions.fetchUser;
const createOrUpdateUser = userFunctions.createOrUpdateUser;
const { enableHotspotUser } = require('./mikrotikFunctions');

router.get('/test', verifyToken, (req, res) => {
    res.json({ message: 'Hello from the GET endpoint!' });
});

// Endpoint to generate credentials
router.get('/generate-credentials', verifyToken, async (req, res) => {
    try {
        const password = generatePassword();
        const voucher = await generateUniqueVoucher();
        res.json({
            password,
            voucher,
            message: 'Credentials generated successfully'
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST endpoint to create a voucher
router.post('/create-voucher', verifyToken, async (req, res) => {
    try {
        const { plan_id, customer } = req.body;

        // Validate customer name
        if (!customer || typeof customer !== 'string' || customer.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'You must provide a valid customer name'
            });
        }

        // Validate plan_id
        if (!plan_id || isNaN(plan_id) || plan_id <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or missing plan_id'
            });
        }

        // Call createVoucher function
        const result = await createVoucher(plan_id, customer);

        // Check if voucher creation was successful
        if (!result.success) {
            return res.status(404).json({
                success: false,
                error: result.error || 'Failed to create voucher'
            });
        }

        const deleteResult = await deleteOldRedeemedVouchers();
        console.log(deleteResult);

        // Return success response with voucher details
        res.status(201).json({
            success: true,
            data: {
                voucher_code: result.voucher_code,
                plan_id: result.plan_id,
                company_id: result.company_id,
                router_id: result.router_id,
                company_username: result.company_username,
                plan_name: result.plan_name,
                plan_validity: result.plan_validity,
                voucher_id: result.voucher_id,
                customer: result.customer,
            }
        });
    } catch (error) {
        console.error('Error in /vouchers endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

router.patch('/redeem-voucher', async (req, res) => {
  const { code_voucher } = req.body;

  const password = generatePassword();

  if (!code_voucher || typeof code_voucher !== 'string' || code_voucher.trim() === '') {
    return res.status(400).json({ success: false, message: 'Voucher code is required.' });
  }

  try {
    const [rows] = await db.execute(
      'SELECT id, plan_validity, redeemed, plan_id, customer, router_id FROM vouchers WHERE code_voucher = ? LIMIT 1',
      [code_voucher.trim()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Voucher not found or already used.' });
    }

    const voucher = rows[0];

    // Check if already redeemed
    if (voucher.redeemed === 1) {
      return res.status(400).json({ success: false, message: 'Voucher has already been redeemed.' });
    }

    // Use moment-timezone to get time in UTC+3 (Africa/Nairobi)
    const startDate = moment().tz('Africa/Nairobi');
    const endDate = moment(startDate).add(voucher.plan_validity, 'hours');

    // Format dates as strings
    const formattedStart = startDate.format('YYYY-MM-DD HH:mm:ss');
    const formattedEnd = endDate.format('YYYY-MM-DD HH:mm:ss');

    // Update the voucher row
    await db.execute(
      'UPDATE vouchers SET redeemed = ?, start_date = ?, end_date = ? WHERE id = ?',
      [1, formattedStart, formattedEnd, voucher.id]
    );

    // Call createOrUpdateUser
    const userCreationResult = await createOrUpdateUser({
        phone_number: voucher.customer.trim(),
        router_id: voucher.router_id,
        plan_id: voucher.plan_id,
        password // This 'password' is the one passed into createOrUpdateUser for new users
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

    // Enable the user on the router
    const enableResult = await enableHotspotUser(voucher.router_id, voucher.customer);

    // Optional: handle failure to enable the user
    if (!enableResult.success) {
        return res.status(500).json({
            success: false,
            message: `Voucher redeemed, but failed to enable hotspot user: ${enableResult.message}`,
        });
    } else {
        console.log("Mikrotik enable user successful!");
    }

    // Return response after successful enable
    return res.status(200).json({
    success: true,
    message: 'Voucher has been redeemed successfully.',
    data: {
        id: voucher.id,
        voucher_code: code_voucher,
        plan_validity: voucher.plan_validity,
        start_date: formattedStart,
        end_date: formattedEnd,
        phone_number: voucher.customer,
        password: finalPassword // Use the password returned from the function
    }
    });
  } catch (error) {
    console.error('Error redeeming voucher:', error);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

router.get('/user', async (req, res) => {
  const { customer } = req.body;

  const result = await fetchUser(customer);
  return res.status(result.success ? 200 : 400).json(result);
});

router.post('/create-user', async (req, res) => {
  const { phone_number, router_id, plan_id } = req.body;

  // Validate required fields
  if (
    !phone_number || typeof phone_number !== 'string' || phone_number.trim() === '' ||
    !router_id || isNaN(router_id) ||
    !plan_id || isNaN(plan_id)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Missing or invalid phone_number, router_id, or plan_id.'
    });
  }

  const password = generatePassword();

  const result = await createOrUpdateUser({
    phone_number: phone_number.trim(),
    router_id,
    plan_id,
    password
  });

  return res.status(result.success ? 200 : 400).json(result);
});

router.post('/enable-user', async (req, res) => {
  const { router_id, hotspot_user } = req.body;
  const result = await enableHotspotUser(router_id, hotspot_user);
  res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;