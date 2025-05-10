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
  
      if (!router_id || !Array.isArray(clients)) {
        return res.status(400).json({ success: false, error: 'router_id and clients array are required' });
      }
  
      console.log('Received client import data:', clients.length);
  
      const routerDetails = await getRouterByID(router_id, company_id);
      console.log('Router Details:', routerDetails);
  
      const pppoePlans = await getPppoePlansByRouterId(router_id);
  
      if (!pppoePlans || !Array.isArray(pppoePlans) || pppoePlans.length === 0) {
        return res.status(404).json({ error: 'No PPPoE plans found for the given router ID' });
      }
  
      // Enrich client data with matching plans and metadata
      const enrichedClients = clients.slice(0, 2).map(client => {
        const profile = client.profile || '';
        const matchingPlan = findMatchingPlan(profile, pppoePlans);
  
        return {
          ...client,
          plan_id: matchingPlan?.id || null,
          plan_price: matchingPlan?.plan_price || null,
          plan_name: matchingPlan?.plan_name || '',
          company_id,
          router_id
        };
      });
  
      // Insert each client into DB
      for (const client of enrichedClients) {
        const {
          phone = '',
          smsGroup = '',
          router_id,
          company_id,
          disabled,
          endDate = '',
          plan_name = '',
          plan_id = null,
          plan_price = '',
          location = '',
          name,
          password,
          brand = '',
          comment = '',
          full_name = '',
        } = client;
      
        const active = disabled ? 0 : 1;
        const formattedEndDate = endDate ? new Date(`${endDate}T08:00:00`) : null;
      
        // Check for existing client with same secret and router_id
        const [existing] = await db.query(
          'SELECT id FROM pppoe_clients WHERE secret = ? AND router_id = ? LIMIT 1',
          [name, router_id]
        );
      
        if (existing.length > 0) {
          console.log(`Skipping duplicate client: ${name} (router_id: ${router_id})`);
          continue; // Skip this client
        }
      
        const sql = `
          INSERT INTO pppoe_clients (
            phone_number,
            sms_group,
            router_id,
            company_id,
            active,
            end_date,
            plan_name,
            type,
            plan_id,
            plan_fee,
            location,
            secret,
            password,
            portal_password,
            brand,
            comments,
            full_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
      
        const values = [
          phone,
          smsGroup,
          router_id,
          company_id,
          active,
          formattedEndDate,
          plan_name,
          'pppoe',
          plan_id,
          plan_price,
          location,
          name,
          password,
          'N0t4P4$$w0Rd',
          brand,
          comment,
          full_name
        ];
      
        try {
          await db.query(sql, values);
        } catch (err) {
          console.error(`Failed to insert client ${name}:`, err.message);
          return res.status(500).json({
            success: false,
            error: `Failed to insert client ${name}`,
            details: err.message
          });
        }
      }
      
  
      return res.status(200).json({
        success: true,
        message: 'All clients imported successfully',
        count: enrichedClients.length
      });
  
    } catch (error) {
      console.error('Error processing client import:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to process client import',
        details: error.message
      });
    }
  });
  

module.exports = router;