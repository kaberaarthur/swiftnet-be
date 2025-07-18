const express = require('express');
const db = require('../dbPromise'); // Ensure dbPromise is promise-based
const { runSSHCommand } = require('./sshCommand');

const router = express.Router();
const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET;

const { getRouterDetails } = require('./mikrotikFunctions');


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

    const routerDetails = await getRouterDetails(router_id);
    if (!routerDetails.success) {
        return res.status(404).json({ success: false, message: 'Router not found' });
    }
    thisRouter = routerDetails.data;

    try {
        const [existingPlans] = await db.execute(`SELECT * FROM hotspot_plans WHERE id = ?`, [id]);
        if (existingPlans.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const currentPlan = existingPlans[0];
        let sshCommand = '';

        if (
            plan_name !== currentPlan.plan_name ||
            shared_users !== currentPlan.shared_users ||
            bandwidth !== currentPlan.bandwidth ||
            plan_validity !== currentPlan.plan_validity
        ) {
            const updatedPlanName = plan_validity ? `${plan_validity}hours` : currentPlan.plan_name;
            sshCommand = `/ip hotspot user profile set [find name="${currentPlan.plan_name}"] ` +
                `name=${updatedPlanName} shared-users=${shared_users || currentPlan.shared_users} rate-limit=${bandwidth || currentPlan.bandwidth}M/${bandwidth || currentPlan.bandwidth}M`;

            const sshOutput = await runSSHCommand(sshCommand, thisRouter.ip_address, thisRouter.username, thisRouter.router_secret, thisRouter.port);
            if (sshOutput.includes('failure')) {
                return res.status(500).json({ error: 'Failed to update MikroTik profile' });
            }
        }

        const updateQuery = `
            UPDATE hotspot_plans SET 
            plan_name = ?, plan_type = ?, limit_type = ?, data_limit = ?, bandwidth = ?, plan_price = ?, 
            shared_users = ?, plan_validity = ?, company_username = ?, company_id = ?, router_id = ?, router_name = ?
            WHERE id = ?
        `;

        await db.execute(updateQuery, [
            plan_name || currentPlan.plan_name,
            plan_type || currentPlan.plan_type,
            limit_type || currentPlan.limit_type,
            data_limit || currentPlan.data_limit,
            bandwidth || currentPlan.bandwidth,
            plan_price || currentPlan.plan_price,
            shared_users || currentPlan.shared_users,
            plan_validity || currentPlan.plan_validity,
            company_username || currentPlan.company_username,
            company_id || currentPlan.company_id,
            router_id || currentPlan.router_id,
            router_name || currentPlan.router_name,
            id
        ]);

        res.status(200).json({ message: 'Hotspot Plan updated successfully' });
    } catch (err) {
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
