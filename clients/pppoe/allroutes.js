const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { runSSHCommand } = require('../sshCommand');
const { Client } = require('ssh2');
const ssh = new Client();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const { sendSMS, executeSSHCommand, changePppoePlan, getRouterDetails, checkCompanySubscription } = require('./functions');
const { verifyToken } = require('../../systemFunctions');

require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET;

const redisClient = require("../../services/redis");


// A function to get the Mikrotik Details Dynamically
// Include a check to see whether that router belongs to the company of the registered user
const getRouterById = async (id) => {  
    // Validate input ID
    console.log("Fetch Router of ID: ", id)
  
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


// Function to create a PPPoE user
async function createPPPoEUser(routerIp, routerUsername, routerPassword, phoneNumber, password, planName) {
    const command = `/ppp secret add name="${phoneNumber}" password="${password}" profile="${planName}" service=pppoe`;

    return new Promise((resolve, reject) => {
        const ssh = new Client();

        ssh.on('ready', () => {
            ssh.exec(command, (err, stream) => {
                if (err) {
                    ssh.end();
                    return resolve({
                        success: false,
                        error: `SSH command execution failed: ${err.message}`,
                    });
                }

                let output = ''; // Collect all output from stdout and stderr

                // Collect data from stdout and stderr
                stream.on('data', (data) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    output += data.toString();
                });

                stream.on('close', () => {
                    ssh.end();

                    // If there is any output, treat it as a failure
                    if (output.trim()) {
                        return resolve({
                            success: false,
                            error: `Command failed with output: ${output.trim()}`,
                        });
                    }

                    // No output indicates success
                    return resolve({
                        success: true,
                        data: 'PPPoE user created successfully.',
                    });
                });
            });
        });

        ssh.on('error', (err) => {
            resolve({
                success: false,
                error: `SSH connection error: ${err.message}`,
            });
        });

        ssh.connect({
            host: routerIp,
            port: 22,
            username: routerUsername,
            password: routerPassword,
        });
    });
}


// Get details about the Plan you want to register the User on from DB
const getPlanDetails = async (id) => {
    try {
        // Get a connection from the pool
        const connection = await db.getConnection();
        
        // Query the database for the plan with the given id
        const [rows] = await connection.query('SELECT * FROM pppoe_plans WHERE id = ?', [id]);
        
        // Release the connection back to the pool
        connection.release();

        // If the plan exists, return it; otherwise, return null
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching plan details:', error);
        throw new Error('Failed to fetch plan details');
    }
};

router.get("/log", verifyToken, (req, res) => {
    console.log("Endpoint /log was accessed!");
    res.send("Check your console, log recorded!");
});
  
// Add code to get Plan Details from DB
// Create a new PPPoE client
// Add a function to check if company is within subscription limitations
router.post('/pppoe-clients', verifyToken, async (req, res) => {
  const company_id = req.companyId;

  try {
    const {
      account,
      full_name,
      email,
      password,
      portal_password,
      address,
      phone_number,
      payment_no,
      sms_group,
      installation_fee,
      router_id,
      plan_id,
      company_username,
      fat_no,
      active,
      rate_limit,
      type,
      secret,
      brand,
      comments // New field
    } = req.body;

    console.log("Brand Name: ", brand);

    // ✅ 1. Get Subscription Info from Redis Cache
    const cachedData = await redisClient.get("company_usage_summary");
    if (!cachedData) {
      return res.status(500).json({
        success: false,
        message: "Subscription data unavailable. Try again shortly."
      });
    }

    const subscription = JSON.parse(cachedData);
    const company = subscription.find(c => c.id === company_id);

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found in subscription data." });
    }

    // ✅ 2. Check if Company is Active
    if (!company.active) {
      return res.status(403).json({ success: false, message: "Your company subscription is not active." });
    }

    // ✅ 3. Determine total users based on plan ID
    let totalUsers = 0;
    switch (company.company_plan_id) {
      case 1: // Hotspot Only
        return res.status(403).json({
          success: false,
          message: "Your plan does not support PPPoE transactions."
        });
      case 2: // PPPoE Only
        totalUsers = company.total_pppoe_users || 0;
        break;
      case 3: // Hotspot + PPPoE
        totalUsers = (company.total_pppoe_users || 0) + (company.total_hotspot_users || 0);
        break;
      default:
        return res.status(400).json({ success: false, message: "Invalid or unsupported company plan." });
    }

    // ✅ 4. Check if total users exceed allowed users
    const allowed = company.allowed_users || 0;
    if (allowed > 0 && totalUsers >= allowed) {
      return res.status(403).json({
        success: false,
        message: `User limit reached (${allowed}). Please upgrade your subscription plan.`
      });
    }

    // ✅ 5. Get Router Details
    const router_id_no = Number(router_id);
    const routerDetails = await getRouterById(router_id_no);
    if (!routerDetails) {
      throw new Error(`Router with ID ${router_id_no} not found.`);
    }

    const { ip_address: router_ip, username: router_username, router_secret: router_password } = routerDetails;

    // ✅ 6. Get Plan Details
    const planDetails = await getPlanDetails(plan_id);
    if (!planDetails) {
      throw new Error(`Plan with ID ${plan_id} not found.`);
    }

    const plan_name = planDetails.plan_name;
    const plan_fee = parseFloat(planDetails.plan_price);

    // ✅ 7. Create PPPoE User on Router
    const createUserResponse = await createPPPoEUser(
      router_ip,
      router_username,
      router_password,
      secret,
      password,
      plan_name
    );

    if (!createUserResponse.success) {
      throw new Error(`MikroTik error: ${createUserResponse.error || "Unknown error"}`);
    }

    // ✅ 8. Insert new client into database
    const query = `
      INSERT INTO pppoe_clients (
        account, full_name, email, password, portal_password, secret, location, phone_number,
        payment_no, sms_group, installation_fee, router_id, plan_name,
        plan_id, plan_fee, company_id, company_username, fat_no, active, rate_limit, type, brand,
        comments, start_date, end_date, date_created
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
        CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP() + INTERVAL 4 HOUR, CURRENT_TIMESTAMP())`;

    const [result] = await db.execute(query, [
      account, full_name, email, password, portal_password, secret, address, phone_number,
      payment_no, sms_group, installation_fee, router_id, plan_name,
      plan_id, plan_fee, company_id, company_username, fat_no, active, rate_limit, type, brand,
      comments ?? null
    ]);

    console.log("✅ PPPoE Client Created:", { id: result.insertId, account });

    // ✅ 9. Return success response
    res.status(201).json({
      success: true,
      id: result.insertId,
      message: "Client created successfully"
    });

  } catch (error) {
    console.error("❌ Error in /pppoe-clients:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error Occurred"
    });
  }
});


// Get PPPoE clients with optional query parameters
router.get('/pppoe-clients', verifyToken, async (req, res) => {
    const { router_id, active, type, phone_number } = req.query;
    const company_id = req.companyId; // Always provided by verifyToken
    console.log("Getting PPPoE Clients...");

    // Base query filtered by company
    let query = 'SELECT * FROM pppoe_clients WHERE company_id = ?';
    const params = [company_id];

    if (router_id) {
        query += ' AND router_id = ?';
        params.push(router_id);
    }

    if (typeof active !== 'undefined') {
        query += ' AND active = ?';
        params.push(active);
    }

    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }

    if (phone_number) {
        query += ' AND phone_number LIKE ?';
        params.push(`%${phone_number}%`);
    }

    try {
        const [clients] = await db.execute(query, params);
        res.json(clients);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get PPPoE clients router, created for the cronjob
router.get('/pppoe-clients-cron', async (req, res) => {
    const { router_id, active, type, phone_number } = req.query;

    let query = 'SELECT * FROM pppoe_clients WHERE 1=1';
    const params = [];

    if (router_id) {
        query += ' AND router_id = ?';
        params.push(router_id);
    }

    if (typeof active !== 'undefined') {
        query += ' AND active = ?';
        params.push(active);
    }

    if (type) {
        query += ' AND type = ?';
        params.push(type);
    }

    if (phone_number) {
        query += ' AND phone_number LIKE ?'; // Use LIKE for partial matching if needed
        params.push(`%${phone_number}%`);
    }

    try {
        const [clients] = await db.execute(query, params);
        res.json(clients);
    } catch (error) {
        res.status(500).json({ success:false, message: error.message });
    }
});

// Activate client in case he paid but was not enabled
router.post('/activate-client', async (req, res) => {
    const { client_id } = req.body;

    console.log(`Received request to activate ${client_id}`);

    if (!client_id) {
        return res.status(400).json({
            success: false,
            message: "client_id is required"
        });
    }

    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // Step 1: Update the client
        const updateQuery = 'UPDATE pppoe_clients SET active = 1 WHERE id = ?';
        const [updateResult] = await connection.execute(updateQuery, [client_id]);

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Step 2: Fetch the updated record (on the same connection)
        const selectQuery = 'SELECT id, secret, active FROM pppoe_clients WHERE id = ?';
        const [rows] = await connection.execute(selectQuery, [client_id]);

        await connection.commit();

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Client found but fetch failed"
            });
        }

        // Step 3: Return the updated fields
        res.json({
            success: true,
            message: `Client ${client_id} activated`,
            client: rows[0]
        });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({
            success: false,
            message: error.message
        });
    } finally {
        connection.release(); // Return connection to pool
    }
});


// Get a single PPPoE client by ID
router.get('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [client] = await db.execute('SELECT * FROM pppoe_clients WHERE id = ?', [id]);

        if (client.length === 0) {
            return res.status(404).json({ message: 'Client not registered with us' });
        }
        // console.log(client[0].end_date);

        res.json(client[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// Update PPPoE client details (PATCH) with plan change and MikroTik update
router.patch('/edit-pppoe-client/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const company_id = req.companyId;

    // ✅ Check subscription status
    const subStatus = await checkCompanySubscription(company_id);
    console.log(`User Company ID: ${company_id}`);
    console.log("Subscription Status: ", subStatus);
    if (!subStatus.success) {
        return res.status(subStatus.status).json({
            success: false,
            message: subStatus.message,
        });
    }

    try {
        // Step 1: Fetch the existing client to compare router_id
        const [clientResult] = await db.execute('SELECT * FROM pppoe_clients WHERE id = ?', [id]);

        if (!clientResult.length) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const client = clientResult[0];

        const planNameChanged = updates.plan_name && updates.plan_name !== client.plan_name;
        const routerChanged = updates.router_id && Number(updates.router_id) !== Number(client.router_id);

        console.log("Plan name changed:", planNameChanged);
        console.log("Router changed:", routerChanged);

        // Step 2: Build dynamic SQL query for allowed fields only
        const allowedFields = [
            "sms_group", "end_date", "plan_fee", "brand", "full_name",
            "location", "plan_name", "plan_id", "active", "installation_fee",
            "comments", "phone_number", "router_id"  // router_id allowed so it persists to DB
        ];

        let query = "UPDATE pppoe_clients SET ";
        const params = [];

        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                query += `${key} = ?, `;
                params.push(updates[key]);
            }
        }

        if (params.length === 0) {
            return res.status(400).json({ message: "No valid fields provided for update" });
        }

        query = query.slice(0, -2) + ', updated_at = CURRENT_TIMESTAMP() WHERE id = ?';
        params.push(id);

        // Step 3: Execute the DB update first
        const result = await db.execute(query, params);

        // Step 4: Resolve which router to use for SSH operations.
        // - If only the plan changed (same router) → SSH on the current/original router.
        // - If the router also changed → skip plan SSH entirely (admin handled MikroTik manually).
        // - For active/enable/disable → use the router that now owns the client (new router if changed).
        const sshRouterId = routerChanged ? updates.router_id : client.router_id;
        const routerDetails = await getRouterDetails(sshRouterId);

        if (!routerDetails || !routerDetails.ip_address) {
            console.error("Error: Router Connection Impaired");
            return res.status(404).json({ error: "Router Connection Impaired" });
        }

        // Step 5: Handle plan change SSH — only when router has NOT changed.
        // If the router changed, the admin already migrated the PPP secret on MikroTik manually.
        if (planNameChanged && !routerChanged) {
            console.log("Plan-only change — running SSH on current router to update MikroTik profile.");
            console.log("Switching to plan:", updates.plan_name, "| Client secret:", updates.secret);

            const change_result = await changePppoePlan(
                routerDetails.ip_address,
                routerDetails.username,
                routerDetails.router_secret,
                updates.secret,
                updates.plan_name,
                routerDetails.port
            );

            if (change_result.status !== 'success') {
                return res.status(500).json({
                    message: 'Client updated in DB, but failed to change PPPoE plan on MikroTik.',
                    affectedRows: result.affectedRows,
                    error: change_result.message
                });
            }

            console.log("MikroTik profile updated successfully via SSH.");

        } else if (planNameChanged && routerChanged) {
            // Router moved — admin already handled the PPP secret migration on MikroTik.
            // Only the DB update (above) is needed here.
            console.log("*****################################################*****");
            console.log("Router change detected alongside plan change. Skipping plan SSH — admin has handled MikroTik manually.");
            console.log("*****################################################*****");
        }

        // Step 6: Handle active/inactive toggle on MikroTik.
        // Uses the new router if router changed, otherwise the original one.
        // Note: sshRouterId and routerDetails are already resolved above to the correct router.
        if (updates.active !== undefined) {
            try {
                const command = updates.active == 1 ? "enable" : "disable";

                const mikrotikResult = await executeSSHCommand(
                    routerDetails.ip_address,
                    routerDetails.username,
                    routerDetails.router_secret,
                    updates.secret,
                    command,
                    routerDetails.port
                );

                if (mikrotikResult.status !== 'success') {
                    console.error(`Failed to ${command} client on MikroTik:`, mikrotikResult.message);
                    return res.status(500).json({
                        message: `Client updated in DB, but ${command} on MikroTik failed.`,
                        error: mikrotikResult.message
                    });
                }

                console.log(`Client successfully ${command}d on MikroTik:`, mikrotikResult);

            } catch (error) {
                console.error("Error toggling client active state on MikroTik:", error);
                return res.status(500).json({
                    message: "Client updated in DB, but an error occurred while toggling active state on MikroTik.",
                    error: error.message
                });
            }
        }

        // Successful response
        return res.json({
            message: 'Client updated successfully.',
            affectedRows: result.affectedRows,
        });

    } catch (err) {
        console.error('Database update failed:', err);
        return res.status(500).json({
            message: 'Failed to update client in the database.',
            error: err.message
        });
    }
});

// Update PPPoE client details (PATCH)
router.patch('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    console.log("This Plan: ", id)

    try {
        // Step 1: Fetch the existing client from the database
        const [clientResult] = await db.execute('SELECT * FROM pppoe_clients WHERE id = ?', [id]);

        if (!clientResult.length) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const client = clientResult[0];
        console.log("Fetched Client:", client);
        const { phone_number, router_id } = client; // Cannot edit `phone_number` (MikroTik secret name)

        // Step 2: Check if `plan_name` (profile) is being updated
        if (updates.plan_name && updates.plan_name !== client.plan_name) {
            console.log("Switch to: ", updates.plan_name)
            console.log("For Client: ", client.secret)
            // Step 2a: Fetch router details using `getRouterById`
            const routerDetails = await getRouterById(router_id);

            if (!routerDetails) {
                return res.status(404).json({ message: 'Router details not found for this client' });
            }

            const { ip_address, username, router_secret, port=22 } = routerDetails;

            // Step 2b: Update profile in MikroTik
            const mikrotikCommand = `/ppp secret set [find name="${client.secret}"] profile="${updates.plan_name}"`;

            // Execute SSH command
            const sshResult = await new Promise((resolve) => {
                ssh.on('ready', () => {
                    ssh.exec(mikrotikCommand, (err, stream) => {
                        if (err) {
                            ssh.end();
                            return resolve({ success: false, error: `SSH command failed: ${err.message}` });
                        }

                        let stdout = '';
                        let stderr = '';

                        stream.on('data', (data) => {
                            stdout += data.toString();
                        });

                        stream.stderr.on('data', (data) => {
                            stderr += data.toString();
                        });

                        stream.on('close', () => {
                            ssh.end();

                            if (stderr || stdout.toLowerCase().includes('failure') || stdout.toLowerCase().includes('input does not match')) {
                                return resolve({ success: false, error: stderr || stdout });
                            }

                            resolve({ success: true, data: stdout });
                        });
                    });
                });

                ssh.on('error', (err) => {
                    resolve({ success: false, error: `SSH connection error: ${err.message}` });
                });

                ssh.connect({
                    host: ip_address,
                    port,
                    username: username,
                    password: router_secret,
                });
            });

            if (!sshResult.success) {
                return res.status(500).json({ message: `Error updating MikroTik profile: ${sshResult.error}` });
            }
        }

        // Step 3: Generate dynamic SQL query for updating other fields
        let query = 'UPDATE pppoe_clients SET ';
        const params = [];

        for (const key in updates) {
            if (updates.hasOwnProperty(key) && key !== 'phone_number') {
                query += `${key} = ?, `;
                params.push(updates[key]);
            }
        }

        // Add timestamp and id to the query
        query = query.slice(0, -2) + ', updated_at = CURRENT_TIMESTAMP() WHERE id = ?';
        params.push(id);

        // Step 4: Execute the update query in the database
        const result = await db.execute(query, params);

        res.json({ message: 'Client updated', affectedRows: result.affectedRows });
    } catch (error) {
        // Error handling
        res.status(500).json({ message: error.message });
    }
});

// POST /send-otp-sms
router.post('/send-otp-sms', async (req, res) => {
  const { client_id, phone_number } = req.body;

  if (!client_id || !phone_number) {
    return res.status(400).json({ message: 'client_id and phone_number are required.' });
  }

  try {
    const result = await sendSMS(client_id, phone_number);
    res.status(200).json({ message: 'OTP sent successfully.', result });
  } catch (error) {
    console.error('Failed to send OTP:', error);
    res.status(500).json({ message: 'Failed to send OTP.', error: error.message });
  }
});

router.patch('/pppoe-clients-change-plan/:id', async (req, res) => {
    const { id } = req.params;
    const { plan_id, plan_name, plan_fee, otp } = req.body;
  
    if (!plan_id || !plan_name || !plan_fee || !otp) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Generate random 6-digit OTP
    const scrambledOtp = Math.floor(100000 + Math.random() * 900000);
  
    try {
      // Check if the client exists
      const [clientResult] = await db.execute(
        'SELECT * FROM pppoe_clients WHERE id = ?',
        [id]
      );
  
      if (clientResult.length === 0) {
        return res.status(404).json({ message: 'Client not found.' });
      }
      
      // Check OTP
      if (otp == clientResult[0].otp) {
        // Update plan info
        const [updateResult] = await db.execute(
            `UPDATE pppoe_clients
            SET plan_id = ?, plan_name = ?, plan_fee = ?, otp = ?
            WHERE id = ?`,
            [plan_id, plan_name, plan_fee, scrambledOtp, id]
        );
    
        res.json({ message: 'Your subscription plan was changed successfully.', success: true });
      } else {
        res.status(500).json({ message: 'You entered an Invalid OTP Code', success: false });
      }

    } catch (error) {
      console.error('Error updating plan details:', error);
      res.status(500).json({ message: 'Internal server error.', success: false });
    }
});
  

router.delete('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Step 1: Fetch the PPPoE client from the database
        const [clientResult] = await db.execute('SELECT secret, phone_number, router_id, full_name FROM pppoe_clients WHERE id = ?', [id]);

        if (clientResult.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const { secret, phone_number, router_id } = clientResult[0];

        // Step 2: Get router details
        const routerDetails = await getRouterById(router_id);
        if (!routerDetails) {
            return res.status(404).json({ message: 'Router details not found for this client' });
        }

        const { ip_address, username, router_secret, port } = routerDetails;

        const ssh = new Client();
        const sshResult = await new Promise((resolve) => {
            ssh.on('ready', () => {
                // Step 3a: Remove active connection
                const removeActiveCmd = `/ppp active remove [find name="${secret}"]`;
                // Step 3b: Remove PPP secret
                const removeSecretCmd = `/ppp secret remove [find name="${secret}"]`;

                ssh.exec(`${removeActiveCmd} ; ${removeSecretCmd}`, (err, stream) => {
                    if (err) {
                        ssh.end();
                        return resolve({ success: false, error: `SSH command failed: ${err.message}` });
                    }

                    let stdout = '';
                    let stderr = '';

                    stream.on('data', (data) => {
                        stdout += data.toString();
                    });

                    stream.stderr.on('data', (data) => {
                        stderr += data.toString();
                    });

                    stream.on('close', () => {
                        ssh.end();

                        if (stderr || stdout.toLowerCase().includes('failure')) {
                            return resolve({ success: false, error: stderr || stdout });
                        }

                        resolve({ success: true, data: stdout });
                    });
                });
            });

            ssh.on('error', (err) => {
                resolve({ success: false, error: `SSH connection error: ${err.message}` });
            });

            ssh.connect({
                host: ip_address,
                username: username,
                password: router_secret,
                port,
            });
        });

        if (!sshResult.success) {
            return res.status(500).json({ message: `Error removing client from MikroTik: ${sshResult.error}` });
        }

        // Step 4: Delete from database
        const result = await db.execute('DELETE FROM pppoe_clients WHERE id = ?', [id]);

        res.json({ message: 'Client and active connection deleted', client: clientResult, affectedRows: result.affectedRows });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.delete('/pppoe-clients-only-system/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Step 1: Fetch the PPPoE client from the database
        const [clientResult] = await db.execute(
            'SELECT secret, phone_number, router_id, full_name FROM pppoe_clients WHERE id = ?',
            [id]
        );

        if (clientResult.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        // Step 2: Delete from database
        const [deleteResult] = await db.execute('DELETE FROM pppoe_clients WHERE id = ?', [id]);

        res.json({
            message: 'Client deleted from the system only (no MikroTik action performed)',
            client: clientResult[0],
            affectedRows: deleteResult.affectedRows,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
