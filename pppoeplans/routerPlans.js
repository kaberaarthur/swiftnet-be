// router.js or inside your main Express routes file
const express = require('express');
const { Client } = require('ssh2');
const db = require('../dbPromise');
const router = express.Router();

// Utility function to parse and clean MikroTik output
function parsePPPProfiles(output) {
    const profiles = [];
    let profile = {};

    const lines = output.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('Flags:')) continue;

        // New profile starts with line like: "0 name=My Profile ..."
        if (/^\d+\s/.test(trimmed) && trimmed.includes('name=')) {
            if (Object.keys(profile).length) profiles.push(profile);
            profile = {};
        }

        // Extract key=value pairs
        const parts = trimmed.split(/\s+/);
        for (const part of parts) {
            if (part.includes('=')) {
                const [key, rawValue] = part.split('=');
                const value = key === 'name' ? rawValue : rawValue?.replace(/^"+|"+$/g, '').replace(/\\"/g, '');
                profile[key] = value;
            }
        }
    }

    if (Object.keys(profile).length) profiles.push(profile);
    return profiles;
}


// Route to get PPPoE plans
router.get('/router-pppoe-plans', async (req, res) => {
    // Get credentials from environment variables for security
    // Alternative: get from request headers or query parameters
    const routerIP = process.env.MIKROTIK_IP || '102.0.14.218';
    const username = process.env.MIKROTIK_USER || 'Arthur';
    const password = process.env.MIKROTIK_PASSWORD || 'Arthur123';
  
    try {
      const profiles = await listPPPoEPlans(routerIP, username, password);
      res.json(profiles);
    } catch (error) {
      console.error('Error fetching PPPoE plans:', error);
      res.status(500).json({ error: 'Failed to fetch PPPoE plans', message: error.message });
    }
  });
  
  /**
   * Connect to MikroTik router and list all PPP profiles
   * @param {string} ipAddress - Router IP address
   * @param {string} username - SSH username
   * @param {string} password - SSH password
   * @returns {Promise<Array>} - Array of profile objects
   */
  function listPPPoEPlans(ipAddress, username, password) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      conn.on('ready', () => {
        conn.exec('/ppp profile print without-paging', (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          
          let data = '';
          let errorData = '';
          
          stream.on('data', (chunk) => {
            data += chunk.toString('utf8');
          });
          
          stream.stderr.on('data', (chunk) => {
            errorData += chunk.toString('utf8');
          });
          
          stream.on('close', () => {
            conn.end();
            
            if (errorData) {
              return reject(new Error(`Router command error: ${errorData}`));
            }
            
            try {
              const profiles = parsePPPProfiles(data);
              resolve(profiles);
            } catch (parseError) {
              reject(new Error(`Failed to parse router output: ${parseError.message}`));
            }
          });
        });
      });
      
      conn.on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      });
      
      conn.connect({
        host: ipAddress,
        port: 22,
        username: username,
        password: password,
        readyTimeout: 10000
      });
    });
  }
  
  /**
   * Parse the MikroTik router output to extract PPP profiles
   * @param {string} output - Raw output from router
   * @returns {Array} - Array of parsed profile objects
   */
  function parsePPPProfiles(output) {
    const profiles = [];
    
    // Split the output by profile entries (numbered lines)
    const profilePattern = /(\d+\s+\**\s+.*?)(?=\n\s*\d+\s+\**|\Z)/gs;
    const profileMatches = output.match(profilePattern) || [];
    
    for (const profileText of profileMatches) {
      const profile = {};
      
      // Get profile ID and default flag
      const idMatch = profileText.match(/^(\d+)\s+(\*?)/);
      if (idMatch) {
        profile.id = parseInt(idMatch[1], 10);
        profile.is_default = Boolean(idMatch[2]);
      }
      
      // Extract attributes using regex
      const nameMatch = profileText.match(/name="([^"]+)"/);
      if (nameMatch) {
        profile.name = nameMatch[1];
      }
      
      const localAddrMatch = profileText.match(/local-address=([^\s]+)/);
      if (localAddrMatch) {
        profile.local_address = localAddrMatch[1];
      }
      
      const remoteAddrMatch = profileText.match(/remote-address=([^\s]+)/);
      if (remoteAddrMatch) {
        profile.remote_address = remoteAddrMatch[1];
      }
      
      const rateLimitMatch = profileText.match(/rate-limit="([^"]+)"/);
      if (rateLimitMatch) {
        profile.rate_limit = rateLimitMatch[1];
      }
      
      const dnsMatch = profileText.match(/dns-server=([^\s]+)/);
      if (dnsMatch) {
        profile.dns_servers = dnsMatch[1].split(',');
      }
      
      // Extract other common attributes
      const commonAttrs = ["use-ipv6", "use-encryption", "use-compression"];
      commonAttrs.forEach(attr => {
        const attrMatch = profileText.match(new RegExp(`${attr}=([^\\s]+)`));
        if (attrMatch) {
          profile[attr.replace(/-/g, '_')] = attrMatch[1];
        }
      });
      
      profiles.push(profile);
    }
    
    return profiles;
  }

  // Import PPPOE Plans from router
  router.post('/router-import-pppoe-plans', async (req, res) => {
      const plansToImport = req.body;
  
      // --- Input Validation ---
      if (!Array.isArray(plansToImport)) {
          return res.status(400).json({ message: 'Invalid input: Expected an array of plans.' });
      }
  
      if (plansToImport.length === 0) {
          return res.status(400).json({ message: 'Invalid input: Plans array cannot be empty.' });
      }
  
      let createdCount = 0;
      let updatedCount = 0;
      const errors = []; // To collect any errors encountered during processing
  
      // --- Process each plan ---
      // Using a for...of loop for sequential processing (easier to debug than Promise.all)
      for (const plan of plansToImport) {
          try {
              // --- Data Extraction and Validation/Transformation ---
              const {
                  name, // Frontend sends 'name', DB uses 'plan_name'
                  plan_price,
                  plan_validity, // In days from frontend
                  router_id,
                  company_id,
                  company_username,
                  rate_limit, // Frontend sends 'rate_limit', DB uses 'rate_limit_string'
                  brand
              } = plan;
  
              // Basic validation for required fields from frontend payload
              if (!name || !plan_price || !plan_validity || !router_id || !company_id || !rate_limit || !company_username) {
                   // Log the problematic plan and skip it
                   console.warn('Skipping plan due to missing required fields:', plan);
                   errors.push({ message: `Skipped plan "${name || 'N/A'}" due to missing required fields.`, planData: plan });
                   continue; // Move to the next plan in the loop
              }
  
              // Convert validity from days to hours
              const validityInHours = parseInt(plan_validity, 10) * 24;
              if (isNaN(validityInHours)) {
                  console.warn(`Skipping plan "${name}" due to invalid validity value:`, plan_validity);
                  errors.push({ message: `Skipped plan "${name}" due to invalid validity value '${plan_validity}'.`, planData: plan });
                  continue;
              }
  
              // --- Check for Existing Plan ---
              // Check by name AND company_id to ensure uniqueness within a company
              const checkQuery = 'SELECT id FROM pppoe_plans WHERE plan_name = ? AND company_id = ?';
              const [existingPlans] = await db.query(checkQuery, [name, company_id]);
  
              const planExists = existingPlans.length > 0;
              const existingPlanId = planExists ? existingPlans[0].id : null;
  
              // --- Perform Update or Insert ---
              if (planExists) {
                  // UPDATE Existing Plan
                  const updateQuery = `
                      UPDATE pppoe_plans SET
                          plan_price = ?,
                          plan_validity = ?,
                          router_id = ?,
                          rate_limit_string = ?,
                          brand = ?,
                          type = ?
                      WHERE id = ?
                  `;
                  const updateParams = [
                      plan_price,
                      validityInHours,
                      router_id,
                      rate_limit, // Mapped directly to rate_limit_string
                      brand,
                      'pppoe', // Always set type to pppoe
                      existingPlanId
                  ];
                  await db.query(updateQuery, updateParams);
                  updatedCount++;
                  console.log(`Updated plan: ${name} (ID: ${existingPlanId}) for company ${company_id}`);
  
              } else {
                  // INSERT New Plan
                  const insertQuery = `
                      INSERT INTO pppoe_plans (
                          plan_name, plan_price, plan_validity, router_id,
                          company_id, company_username, rate_limit_string, brand, type
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `;
                   const insertParams = [
                      name, // Use frontend 'name' for DB 'plan_name'
                      plan_price,
                      validityInHours,
                      router_id,
                      company_id,
                      company_username,
                      rate_limit, // Use frontend 'rate_limit' for DB 'rate_limit_string'
                      brand,
                      'pppoe' // Always set type to pppoe
                  ];
                  await db.query(insertQuery, insertParams);
                  createdCount++;
                   console.log(`Created new plan: ${name} for company ${company_id}`);
              }
  
          } catch (error) {
              // Log the error and the plan that caused it
              console.error(`Error processing plan: ${plan.name || JSON.stringify(plan)}`, error);
              errors.push({ message: `Failed to process plan "${plan.name || 'N/A'}": ${error.message}`, planData: plan });
              // Continue processing other plans even if one fails
          }
      } // End of loop
  
      // --- Send Response ---
      if (errors.length > 0) {
          // Partial success or complete failure
          res.status(errors.length === plansToImport.length ? 500 : 207) // 207 Multi-Status if partially successful
              .json({
                  message: `Processed ${plansToImport.length} plans. See details below.`,
                  created: createdCount,
                  updated: updatedCount,
                  failed: errors.length,
                  errors: errors // Include details about failed plans
              });
      } else {
          // Complete success
          res.status(200).json({
              message: `Successfully processed ${plansToImport.length} plans.`,
              created: createdCount,
              updated: updatedCount
          });
      }
  });

module.exports = router;
