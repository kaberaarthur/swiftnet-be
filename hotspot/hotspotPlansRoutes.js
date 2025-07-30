const express = require('express');
const db = require('../dbPromise'); // Ensure dbPromise is promise-based
const { runSSHCommand } = require('./sshCommand');

const router = express.Router();
const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET;

const { getRouterDetails } = require('./mikrotikFunctions');

const { getHotspotProfiles } = require('./getHotspotProfiles');

// Middleware to verify token
function verifyToken(req, res, next) {
    // Extract the token from the Authorization header
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    // Extract the token from the 'Authorization' header
    const bearerToken = token.split(' ')[1];

    
    // Verify the token
    jwt.verify(bearerToken, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Attach the user ID to the request object
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.companyId = decoded.company_id;
        next();
    });
    
}

// Get Hotspot Plans from the Mikrotik Router
router.get('/hotspot-profiles', verifyToken, async (req, res) => {
  const router_id = req.query.router_id;
  const userCompanyId = req.companyId;
  const userType = req.userType;

  try {
    // Fetch router details
    const routerResponse = await getRouterDetails(router_id);

    if (!routerResponse.success) {
      return res.status(404).json({ success: false, message: 'Router not found' });
    }

    const router = routerResponse.data;

    // Check access permissions
    if (userType !== 'superadmin' && router.company_id !== userCompanyId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied: You can only view profiles for routers belonging to your company' 
      });
    }

    // Prepare the connection object
    const connectionData = {
      host: router.ip_address,
      port: router.port || 22,
      username: router.username,
      password: router.router_secret
    };

    // Fetch hotspot profiles
    const profiles = await getHotspotProfiles(connectionData);

    res.status(200).json({ 
      success: true, 
      message: 'Hotspot profiles retrieved successfully', 
      data: profiles 
    });

  } catch (error) {
    console.error('Error fetching hotspot profiles:', error);
    res.status(500).json({ 
      success: false, 
      message: 'An error occurred while fetching hotspot profiles', 
      error: error.message 
    });
  }
});

// Import Hotspot Plans already present in the router
router.post('/import-hotspot-plans', verifyToken, (req, res) => {
  const { plans, router_id } = req.body;

  if (!Array.isArray(plans)) {
    return res.status(400).json({ success: false, message: 'Plans should be an array.' });
  }

  console.log(`Received ${plans.length} hotspot plans for router ID: ${router_id}\n`);

  plans.forEach((plan, index) => {
    console.log(`Plan #${index + 1}:`, plan);
  });

  res.status(200).json({
    success: true,
    message: `${plans.length} plans received and logged for router ${router_id}.`
  });
});



// CREATE a new Hotspot Plan
router.post('/hotspot-plans', verifyToken, async (req, res) => {
  console.log("Creating Hotspot Plan");

  const {
    plan_name, plan_type, limit_type, data_limit,
    bandwidth, plan_price, shared_users, plan_validity,
    company_username, company_id, router_id, router_name
  } = req.body;

  try {
    // Step 1: Check if plan already exists
    const [existingPlans] = await db.execute(
      `SELECT id FROM hotspot_plans WHERE plan_name = ? AND router_id = ? LIMIT 1`,
      [plan_name, router_id]
    );

    if (existingPlans.length > 0) {
      return res.status(400).json({ error: 'A plan with the same name already exists on this router.' });
    }

    // Step 2: Get router info
    const thisRouterResponse = await getRouterDetails(router_id);
    const thisRouter = thisRouterResponse.data;

    // Step 3: Prepare and run SSH command
    const sshCommand = `/ip hotspot user profile add name="${plan_name}" shared-users=${shared_users} rate-limit=${bandwidth}M/${bandwidth}M`;
    console.log('SSH Command:', sshCommand);

    const sshOutput = await runSSHCommand(sshCommand, thisRouter.ip_address, thisRouter.username, thisRouter.router_secret, thisRouter.port);
    console.log('SSH Output:', sshOutput);

    // Step 4: Save to DB
    // Apply defaults
    const final_limit_type = limit_type ?? 'Time Limit';
    const final_data_limit = data_limit ?? 0;

    const insertQuery = `
      INSERT INTO hotspot_plans 
      (plan_name, plan_type, limit_type, data_limit, bandwidth, plan_price, shared_users, plan_validity, company_username, company_id, router_id, router_name) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    console.log({
        plan_name,
        plan_type,
        final_limit_type,
        final_data_limit,
        bandwidth,
        plan_price,
        shared_users,
        plan_validity,
        company_username,
        company_id,
        router_id,
        router_name
    });


    const [results] = await db.execute(insertQuery, [
      plan_name, plan_type, final_limit_type, final_data_limit, bandwidth, plan_price,
      shared_users, plan_validity, company_username, company_id, router_id, router_name
    ]);

    res.status(201).json({ message: 'Hotspot Plan created successfully!', plan_id: results.insertId });
    
  } catch (err) {
    console.error('Error creating hotspot plan:', err);
    res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
});


// READ all Hotspot Plans filtered by company_id and router_id
router.get('/hotspot-plans', async (req, res) => {
    const { company_id, router_id } = req.query;

    // ✅ Check if company_id is provided
    if (!company_id) {
        return res.status(400).json({ error: 'company_id is required' });
    }

    let query = `SELECT * FROM hotspot_plans WHERE company_id = ?`;
    const params = [company_id];

    if (router_id) {
        query += ` AND router_id = ?`;
        params.push(router_id);
    }

    try {
        const [results] = await db.execute(query, params);
        res.status(200).json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// READ a single Hotspot Plan by ID
router.get('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [results] = await db.execute(`SELECT * FROM hotspot_plans WHERE id = ?`, [id]);
        if (results.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });
        res.status(200).json(results[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// UPDATE a Hotspot Plan by ID
router.put('/hotspot-plans/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userCompanyId = req.companyId; // Extracted from the token by verifyToken middleware
  const {
    plan_name,
    plan_type,
    limit_type,
    data_limit,
    bandwidth,
    plan_price,
    shared_users,
    plan_validity,
    company_username,
    company_id,
    router_id,
    router_name
  } = req.body;

  console.log("Updating Hotspot Plan with ID:", id);

  try {
    // Fetch existing plan
    const [existingPlans] = await db.execute(`SELECT * FROM hotspot_plans WHERE id = ?`, [id]);
    if (existingPlans.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

    const currentPlan = existingPlans[0];

    // Check if the plan belongs to the user's company
    if (currentPlan.company_id !== userCompanyId) {
      return res.status(403).json({ message: 'Access denied: You can only update plans for your company' });
    }

    // Fetch router details
    const routerDetails = await getRouterDetails(router_id ?? currentPlan.router_id);
    if (!routerDetails.success) {
      return res.status(404).json({ success: false, message: 'Router not found' });
    }
    const thisRouter = routerDetails.data;

    // Check if the profile exists
    const checkProfileCommand = `/ip hotspot user profile print where name="${currentPlan.plan_name}"`;
    const checkProfileOutput = await runSSHCommand(
      checkProfileCommand,
      thisRouter.ip_address,
      thisRouter.username,
      thisRouter.router_secret,
      thisRouter.port
    );
    console.log("Check Profile Output:", checkProfileOutput);

    const profileExists = checkProfileOutput.includes(currentPlan.plan_name);

    // Use nullish coalescing to preserve values like 0
    const newPlanName = plan_name ?? currentPlan.plan_name;
    const newSharedUsers = shared_users ?? currentPlan.shared_users;
    const newBandwidth = `${parseInt(bandwidth ?? currentPlan.bandwidth)}M`; // always force Mbps format
    const newPlanValidity = plan_validity ?? currentPlan.plan_validity;

    // Construct SSH command
    let sshCommand = '';
    if (!profileExists) {
      sshCommand = `/ip hotspot user profile add name="${newPlanName}" shared-users=${newSharedUsers} rate-limit=${newBandwidth}/${newBandwidth}`;
      if (newPlanValidity) {
        sshCommand += ` session-timeout=${newPlanValidity}h`;
      }
    } else {
      sshCommand = `/ip hotspot user profile set [find name="${currentPlan.plan_name}"] name="${newPlanName}" shared-users=${newSharedUsers} rate-limit=${newBandwidth}/${newBandwidth}`;
      if (newPlanValidity) {
        sshCommand += ` session-timeout=${newPlanValidity}h`;
      }
    }

    console.log("Running SSH Command:", sshCommand);
    await runSSHCommand(sshCommand, thisRouter.ip_address, thisRouter.username, thisRouter.router_secret, thisRouter.port);

    // Update the database
    const updateQuery = `
      UPDATE hotspot_plans SET 
        plan_name = ?, 
        plan_type = ?, 
        limit_type = ?, 
        data_limit = ?, 
        bandwidth = ?, 
        plan_price = ?, 
        shared_users = ?, 
        plan_validity = ?, 
        company_username = ?, 
        company_id = ?, 
        router_id = ?, 
        router_name = ?
      WHERE id = ?
    `;

    const updateValues = [
      newPlanName,
      plan_type ?? currentPlan.plan_type,
      limit_type ?? currentPlan.limit_type,
      data_limit ?? currentPlan.data_limit,
      parseInt(bandwidth ?? currentPlan.bandwidth),
      plan_price ?? currentPlan.plan_price,
      newSharedUsers,
      newPlanValidity,
      company_username ?? currentPlan.company_username,
      company_id ?? currentPlan.company_id,
      router_id ?? currentPlan.router_id,
      router_name ?? currentPlan.router_name,
      id
    ];

    console.log("Updating DB with:", updateValues);
    await db.execute(updateQuery, updateValues);

    return res.status(200).json({ message: 'Hotspot Plan updated successfully' });
  } catch (err) {
    console.error('Error updating hotspot plan:', err);
    return res.status(500).json({ error: err.message });
  }
});



// Need to be Corrected esp for SSH Command ***
// DELETE a Hotspot Plan by ID
router.delete('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [existingPlans] = await db.execute(`SELECT plan_name FROM hotspot_plans WHERE id = ?`, [id]);
        if (existingPlans.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const routerDetails = await getRouterDetails(existingPlans[0].router_id);
        if (!routerDetails.success) {
            return res.status(404).json({ success: false, message: 'Router not found' });
        }
        thisRouter = routerDetails.data;

        const sshCommand = `/ip hotspot user profile remove [find name="${existingPlans[0].plan_name}"]`;
        const sshOutput = await runSSHCommand(sshCommand, thisRouter.ip_address, thisRouter.username, thisRouter.router_secret, thisRouter.port);


        if (sshOutput.includes('failure')) {
            return res.status(500).json({ error: 'Failed to remove MikroTik profile' });
        }

        await db.execute(`DELETE FROM hotspot_plans WHERE id = ?`, [id]);

        res.status(200).json({ message: 'Hotspot Plan and MikroTik profile deleted successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;