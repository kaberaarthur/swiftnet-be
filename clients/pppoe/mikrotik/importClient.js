const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../../../dbPromise');

async function getRouterByID(router_id, company_id) {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM routers WHERE id = ? AND company_id = ? LIMIT 1',
      [router_id, company_id]
    );

    if (rows.length > 0) {
      return rows[0];
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching router:', error);
    throw error;
  }
}

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
        req.company_id = decoded.company_id;
        next();
    });
};

const getPppoePlansByRouterId = async (router_id) => {
    try {
      const [rows] = await db.query(
        'SELECT id, plan_name, plan_price FROM pppoe_plans WHERE router_id = ?',
        [router_id]
      );
  
      return rows; // Array of plans
    } catch (error) {
      console.error('Error fetching PPPoE plans:', error);
      throw error;
    }
  };

// Helper function to find the most similar plan name
function findMatchingPlan(profile, plans) {
  // Try exact match first
  const exactMatch = plans.find(plan => 
    plan.plan_name.toLowerCase() === profile.toLowerCase()
  );
  
  if (exactMatch) return exactMatch;
  
  // If no exact match, try to find the most similar one
  let bestMatch = null;
  let highestSimilarity = 0;
  
  for (const plan of plans) {
    // Simple similarity check - words contained in both strings
    const profileWords = profile.toLowerCase().split(/\W+/).filter(word => word.length > 0);
    const planWords = plan.plan_name.toLowerCase().split(/\W+/).filter(word => word.length > 0);
    
    let matches = 0;
    for (const word of profileWords) {
      if (planWords.includes(word)) matches++;
    }
    
    const similarity = profileWords.length > 0 ? matches / profileWords.length : 0;
    
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      bestMatch = plan;
    }
  }
  
  // Return the best match if similarity is above threshold, or the first plan as fallback
  return (highestSimilarity > 0.5) ? bestMatch : plans[0];
}

// Endpoint to import MikroTik clients
router.post('/import-mikrotik-clients', verifyToken, async (req, res) => {
  try {
    const company_id = req.company_id;
    const { router_id, clients } = req.body;
    let clientData = clients;
    
    // Log the received data
    console.log('Received client import data:', clientData.length);

    const routerDetails = await getRouterByID(router_id, company_id);
    console.log('Router Details: ', routerDetails);

    const pppoePlans = await getPppoePlansByRouterId(router_id);

    if (!pppoePlans || !Array.isArray(pppoePlans) || pppoePlans.length === 0) {
        return res.status(404).json({ error: 'No PPPoE plans found for the given router ID' });
    }

    // Populate clientData with plan details based on profile matching
    // Using spread operator to ensure all original client fields are preserved
    clientData = clientData.map(client => {
      const profile = client.profile || '';
      const matchingPlan = findMatchingPlan(profile, pppoePlans);
      
      // This preserves all original client fields and adds the plan fields, company_id, and router_id
      return {
        ...client,
        plan_id: matchingPlan.id,
        plan_price: matchingPlan.plan_price,
        plan_name: matchingPlan.plan_name,
        company_id: company_id,
        router_id: router_id
      };
    });
    
    // Log the first five entries to verify
    console.log('First five clients with plan data:');
    clientData.slice(0, 5).forEach((client, index) => {
      // Log complete client object to show all fields are preserved
      console.log(`Client ${index + 1}:`, client);
      
      // Also log specific plan-related fields for quick verification
      console.log(`Client ${index + 1} plan info:`, {
        profile: client.profile,
        plan_id: client.plan_id,
        plan_name: client.plan_name,
        plan_price: client.plan_price,
        company_id: client.company_id,
        router_id: client.router_id
      });
    });
    
    // Send back a success response
    res.status(200).json({ 
      success: true, 
      message: 'Client data received and processed successfully',
      count: Array.isArray(clientData) ? clientData.length : 0
    });
  } catch (error) {
    console.error('Error processing client import:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process client import', 
      details: error.message 
    });
  }
});

module.exports = router;