const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const { findUnusedIPs } = require('../unusedIPFunction');

// MikroTik router credentials
const router_ip = '102.0.5.26';
const username = 'Arthur';
const password = 'Arthur';

// Experiment
// CREATE: Add a new static plan
router.post('/static-plans-exp', async (req, res) => {
  const { plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username } = req.body;

  // Check if all required fields are present
  if (!plan_name || !rate_limit || !plan_price || !pool_name || !plan_validity || !router_id || !company_id || !company_username) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    // Step 1: Prepare the MikroTik API request payload
    const mikrotikPayload = {
      "name": `${plan_name}`,
      "local-address": "10.10.0.1", // Fixed local address, can be modified
      "remote-address": `${pool_name}`, // Use pool_name directly as the remote address
      "rate-limit": `${rate_limit}k/${rate_limit}k` // Symmetrical upload/download rate limit
    };

    console.log(mikrotikPayload);

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
      return res.status(500).json({ message: 'Failed to create PPP profile on MikroTik', error: mikrotikData });
    }

    // Step 3: Insert the data into the database (if MikroTik profile creation was successful)
    const query = `
      INSERT INTO static_plans 
      (plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.query(query, [plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username]);

    // Respond with success
    res.status(201).json({ message: 'Static plan created successfully', mikrotik_response: mikrotikData });
  } catch (error) {
    console.error('Error creating static plan:', error.message);
    res.status(500).json({ message: 'Error creating static plan', error });
  }
});
// Experiment

// CREATE: Add a new static plan
router.post('/static-plans', async (req, res) => {
    const { plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username } = req.body;
    
    // Check if all required fields are present
    if (!plan_name || !rate_limit || !plan_price || !pool_name || !plan_validity || !router_id || !company_id || !company_username) {
      return res.status(400).json({ message: "All fields are required" });
    }
  
    // Insert query excluding date_created as it's set by the database
    const query = `
      INSERT INTO static_plans 
      (plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    try {
      // Execute the query with provided data
      await db.query(query, [plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username]);
      res.status(201).json({ message: 'Static plan created successfully' });
    } catch (error) {
      res.status(500).json({ message: 'Error creating static plan', error });
    }
  });
  

// READ: Get static plans (with optional filtering by company_id and router_id)
router.get('/static-plans', async (req, res) => {
  const { company_id, router_id } = req.query;
  
  let query = 'SELECT * FROM static_plans WHERE 1=1'; // 1=1 is a placeholder that allows appending more conditions
  const params = [];

  if (company_id) {
    query += ' AND company_id = ?';
    params.push(company_id);
  }

  if (router_id) {
    query += ' AND router_id = ?';
    params.push(router_id);
  }

  try {
    const [results] = await db.query(query, params);
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching static plans', error });
  }
});

// SHOW: Get a specific static plan by id
router.get('/static-plans/:id', async (req, res) => {
  const { id } = req.params;

  const query = 'SELECT * FROM static_plans WHERE id = ?';
  
  try {
    const [rows] = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Static plan not found' });
    }
    res.status(200).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching static plan', error });
  }
});

// UPDATE: Update static plan by id (partial updates allowed)
router.put('/static-plans/:id', async (req, res) => {
  const { id } = req.params;
  const { plan_name, rate_limit, plan_price, pool_name, plan_validity, router_id, company_id, company_username } = req.body;

  // Select current plan data
  let query = 'SELECT * FROM static_plans WHERE id = ?';
  try {
    const [rows] = await db.query(query, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Static plan not found' });
    }

    // If a field is not provided, keep the current value from the database
    const currentData = rows[0];

    const updatedPlan = {
      plan_name: plan_name || currentData.plan_name,
      rate_limit: rate_limit || currentData.rate_limit,
      plan_price: plan_price || currentData.plan_price,
      pool_name: pool_name || currentData.pool_name,
      plan_validity: plan_validity || currentData.plan_validity,
      router_id: router_id || currentData.router_id,
      company_id: company_id || currentData.company_id,
      company_username: company_username || currentData.company_username,
    };

    // Update query
    const updateQuery = `
      UPDATE static_plans
      SET plan_name = ?, rate_limit = ?, plan_price = ?, pool_name = ?, plan_validity = ?, router_id = ?, company_id = ?, company_username = ?
      WHERE id = ?
    `;

    await db.query(updateQuery, [
      updatedPlan.plan_name,
      updatedPlan.rate_limit,
      updatedPlan.plan_price,
      updatedPlan.pool_name,
      updatedPlan.plan_validity,
      updatedPlan.router_id,
      updatedPlan.company_id,
      updatedPlan.company_username,
      id,
    ]);

    res.status(200).json({ message: 'Static plan updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error updating static plan', error });
  }
});

// DELETE: Remove a static plan by id
router.delete('/static-plans/:id', async (req, res) => {
  const { id } = req.params;

  const query = 'DELETE FROM static_plans WHERE id = ?';
  
  try {
    const result = await db.query(query, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Static plan not found' });
    }
    res.status(200).json({ message: 'Static plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting static plan', error });
  }
});

module.exports = router;
