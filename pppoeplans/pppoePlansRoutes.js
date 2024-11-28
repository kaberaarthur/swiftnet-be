const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const { findUnusedIPs } = require('../unusedIPFunction');

// A function to get the Mikrotik Details Dynamically
// Include a check to see whether that router belongs to the company of the registered user
const getRouterById = async (id) => {
  // Import the database connection
  const db = require('../dbPromise'); // Adjust the path to match your directory structure

  // Validate input ID
  if (!id || typeof id !== 'number') {
    console.error("Invalid ID. Please provide a valid integer.");
    return;
  }

  try {
    // Query the database to find the router with the specified ID
    const query = `SELECT * FROM routers WHERE id = ?`;
    const [result] = await db.query(query, [id]);

    // Check if a router was found
    if (result.length === 0) {
      console.log(`No router found with ID: ${id}`);
    } else {
      // Log the router data
      return result[0];
    }
  } catch (error) {
    console.error("Error fetching router data:", error.message);
  }
};


// CREATE: Add a new PPPoE plan and add to Mikrotik
router.post('/pppoe-plans-exp', async (req, res) => {
  const { 
    plan_name, 
    rate_limit,
    plan_price, 
    pool_name, 
    plan_validity, 
    router_id, 
    company_id, 
    company_username, 
    type,
    shared_users
  } = req.body;

  // Check if all required fields are present
  if (
    !plan_name || 
    !rate_limit || 
    !plan_price || 
    !pool_name || 
    !plan_validity || 
    !router_id || 
    !company_id || 
    !company_username || 
    !type ||
    !shared_users
  ) {
    return res.status(400).json({ message: "All fields are required, including 'rate_limit_string' and 'type'" });
  }

  const rate_limit_string = `${rate_limit}k/${rate_limit}k`

  try {
    // Get Router Details
    const routerDetails = await getRouterById(router_id); // Await the async function

    if (routerDetails) {
      // MikroTik router credentials
      const router_ip = routerDetails.ip_address;
      const username = routerDetails.username;
      const password = routerDetails.router_secret;

      // Step 1: Prepare the MikroTik API request payload
      const mikrotikPayload = {
        "name": `${plan_name}`,
        "local-address": "10.10.100.1", // Fixed local address, can be modified
        "remote-address": `${pool_name}`, // Use pool_name directly as the remote address
        "rate-limit": `${rate_limit_string}`, // Use the rate_limit_string direct
      };

      // Step 2: Make the request to MikroTik API
      const mikrotikResponse = await fetch(`http://${router_ip}/rest/ppp/profile/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
        },
        body: JSON.stringify(mikrotikPayload)
      });

      const mikrotikData = await mikrotikResponse.json();

      // Check if the MikroTik request was successful
      if (!mikrotikResponse.ok || !mikrotikData.ret) {
        return res.status(500).json({ success: "false", message: 'Failed to create PPP profile on MikroTik', error: mikrotikData });
      }

      // Step 3: Insert the data into the database
      const query = `
        INSERT INTO pppoe_plans 
        (plan_name, rate_limit, rate_limit_string, plan_price, pool_name, plan_validity, router_id, company_id, company_username, type, mikrotik_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await db.query(query, [plan_name, rate_limit, rate_limit_string, plan_price, pool_name, plan_validity, router_id, company_id, company_username, type, mikrotikData.ret]);

      // Respond with success
      // console.log("Mikrotik Profile ID: ", mikrotikData.ret);
      res.status(201).json({ success: "true", message: 'PPPoE plan created successfully', mikrotik_response: mikrotikData });
    } else {
      console.error('Router not found!');
      res.status(404).json({ success: "false", message: 'Router not found' });
    }
  } catch (error) {
    console.error('Error creating PPPoE plan:', error.message);
    res.status(500).json({ success: "false", message: 'Error creating PPPoE plan', error });
  }
});
  

// READ: Get pppoe plans (with optional filtering by company_id and router_id)
router.get('/pppoe-plans', async (req, res) => {
  const { company_id, router_id, type } = req.query;
  
  let query = 'SELECT * FROM pppoe_plans WHERE 1=1'; // 1=1 is a placeholder that allows appending more conditions
  const params = [];

  if (company_id) {
    query += ' AND company_id = ?';
    params.push(company_id);
  }

  if (router_id) {
    query += ' AND router_id = ?';
    params.push(router_id);
  }

  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  try {
    const [results] = await db.query(query, params);
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({success: "false", message: 'Error fetching pppoe plans', error });
  }
});

// SHOW: Get a specific pppoe plan by id
router.get('/pppoe-plans/:id', async (req, res) => {
  const { id } = req.params;

  const query = 'SELECT * FROM pppoe_plans WHERE id = ?';
  
  try {
    const [rows] = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'PPPOE plan not found' });
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({success: "false", message: 'Error fetching PPPOE plan', error });
  }
});

// PATCH: Update pppoe plan by id (partial updates allowed)
router.patch('/pppoe-plans/:id', async (req, res) => {
  const { id } = req.params;
  const allowedFields = [
    'plan_name',
    'rate_limit',
    'rate_limit_string',
    'plan_price',
    'pool_name',
    'plan_validity',
    'router_id',
    'company_id',
    'company_username'
  ];
  const updates = req.body;

  // Validate that at least one valid field is provided for the update
  const fieldsToUpdate = Object.keys(updates).filter(field => allowedFields.includes(field));

  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ message: 'No valid fields provided for update' });
  }

  try {
    // Step 1: Retrieve the PPPoE plan details from the database to ensure it exists
    const [existingPlan] = await db.query('SELECT * FROM pppoe_plans WHERE id = ?', [id]);
    if (!existingPlan || existingPlan.length === 0) {
      return res.status(404).json({ message: 'PPPoE plan not found' });
    }

    // Step 2: Update the database with the provided fields
    const setClause = fieldsToUpdate.map(field => `${field} = ?`).join(', ');
    const query = `UPDATE pppoe_plans SET ${setClause} WHERE id = ?`;
    const values = [...fieldsToUpdate.map(field => updates[field]), id];

    const [dbResult] = await db.query(query, values);
    if (dbResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Failed to update the PPPoE plan in the database' });
    }

    // Step 3: Respond with success
    res.status(200).json({ success: true, message: 'PPPoE plan updated successfully' });
  } catch (error) {
    console.error('Error updating PPPoE plan:', error.message);
    res.status(500).json({ success: false, message: 'Error updating PPPoE plan', error });
  }
});


// DELETE: Remove a pppoe plan by id
router.delete('/pppoe-plans/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Step 1: Retrieve the PPPoE plan details from the database to check existence
    const selectQuery = 'SELECT * FROM pppoe_plans WHERE id = ?';
    const [existingPlan] = await db.query(selectQuery, [id]);

    if (!existingPlan || existingPlan.length === 0) {
      return res.status(404).json({ success: false, message: 'PPPoE plan not found' });
    }

    // Step 2: Delete the plan from the database
    const deleteQuery = 'DELETE FROM pppoe_plans WHERE id = ?';
    const result = await db.query(deleteQuery, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Failed to delete PPPoE plan from the database' });
    }

    // Step 3: Respond with success
    res.status(200).json({ success: true, message: 'PPPoE plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting PPPoE plan:', error.message);
    res.status(500).json({ success: false, message: 'Error deleting PPPoE plan', error });
  }
});


module.exports = router;
