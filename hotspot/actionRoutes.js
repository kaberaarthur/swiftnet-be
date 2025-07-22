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
const { enableHotspotUser, createMikrotikHotspotUser, getRouterDetails } = require('./mikrotikFunctions');

// Test if Router is reachable
router.post('/ping-router', verifyToken, async (req, res) => {
  const { router_id, ip_address, username, router_secret, port } = req.body;

  let credentials;

  if (router_id) {
    const routerDetails = await getRouterDetails(router_id);
    if (!routerDetails.success) {
      return res.status(404).json({ success: false, message: 'Router not found' });
    }
    credentials = routerDetails.data;
  } else {
    if (!ip_address || !username || !router_secret) {
      return res.status(400).json({ success: false, error: 'Missing required router fields' });
    }
    credentials = { ip_address, username, router_secret, port };
  }

  const { ip_address: host, username: user, router_secret: password, port: sshPort } = credentials;

  const conn = new Client();
  conn
    .on('ready', () => {
      conn.end();
      return res.json({ success: true, message: 'Connection successful' });
    })
    .on('error', (err) => {
      return res.status(500).json({ success: false, error: `SSH connection failed: ${err.message}` });
    })
    .connect({
      host,
      port: sshPort ?? 22,
      username: user,
      password,
    });
});


// POST /mikrotik/create-user
router.post('/create-mikrotik-user', async (req, res) => {
  const { router_id, phone_number, password } = req.body;

  if (!router_id || !phone_number || !password) {
    return res.status(400).json({ success: false, message: 'Missing required parameters' });
  }

  try {
    const routerDetails = await getRouterDetails(router_id);

    if (!routerDetails.success) {
      return res.status(404).json({ success: false, message: 'Router not found' });
    }

    const { ip_address, username, router_secret, port } = routerDetails.data;

    const result = await createMikrotikHotspotUser(
      ip_address,
      username,
      router_secret,
      phone_number,
      password,
      port
    );

    return res.status(result.success ? 200 : 500).json(result);
  } catch (err) {
    console.error('Error in /mikrotik/create-user:', err);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
});

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

    if (voucher.redeemed === 1) {
      return res.status(400).json({ success: false, message: 'Voucher has already been redeemed.' });
    }

    const startDate = moment().tz('Africa/Nairobi');
    const endDate = moment(startDate).add(voucher.plan_validity, 'hours');
    const formattedStart = startDate.format('YYYY-MM-DD HH:mm:ss');
    const formattedEnd = endDate.format('YYYY-MM-DD HH:mm:ss');

    // Step 1: Create or update user
    const userCreationResult = await createOrUpdateUser({
      phone_number: voucher.customer.trim(),
      router_id: voucher.router_id,
      plan_id: voucher.plan_id,
      password
    });

    if (!userCreationResult.success) {
      return res.status(500).json({
        success: false,
        message: userCreationResult.message || 'Failed to create or update user.'
      });
    }

    const finalPassword = userCreationResult.userPassword;

    // Step 2: Retry enableHotspotUser up to 5 times
    let enableSuccess = false;
    let lastEnableResult = null;

    for (let attempt = 1; attempt <= 5; attempt++) {
      lastEnableResult = await enableHotspotUser(voucher.router_id, voucher.customer);
      if (lastEnableResult.success) {
        enableSuccess = true;
        break;
      }
      console.warn(`Enable attempt ${attempt} failed:`, lastEnableResult.message);
      await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1s between attempts
    }

    if (!enableSuccess) {
      return res.status(500).json({
        success: false,
        message: `Failed to enable hotspot user after 5 attempts: ${lastEnableResult.message}`
      });
    }

    // Step 3: Only now update the voucher as redeemed
    await db.execute(
      'UPDATE vouchers SET redeemed = ?, start_date = ?, end_date = ? WHERE id = ?',
      [1, formattedStart, formattedEnd, voucher.id]
    );

    // Final response
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
        password: finalPassword
      }
    });

  } catch (error) {
    console.error('Error redeeming voucher:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
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