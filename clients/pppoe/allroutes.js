const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { runSSHCommand } = require('../sshCommand');
const { Client } = require('ssh2');
const ssh = new Client();
const axios = require('axios');
const jwt = require('jsonwebtoken');

const { sendSMS, executeSSHCommand, changePppoePlan, getRouterDetails } = require('./functions');

require('dotenv').config();

const jwtSecret = process.env.JWT_SECRET;

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

        // Get Router Details
        const router_id_no = Number(router_id);
        const routerDetails = await getRouterById(router_id_no);

        if (!routerDetails) {
            throw new Error(`Router with ID ${router_id_no} not found.`);
        }

        const { ip_address: router_ip, username: router_username, router_secret: router_password } = routerDetails;

        // Get Plan Details
        const planDetails = await getPlanDetails(plan_id);
        if (!planDetails) {
            throw new Error(`Plan with ID ${plan_id} not found.`);
        }

        const plan_name = planDetails.plan_name;
        const plan_fee = parseFloat(planDetails.plan_price);

        
        // Create user on MikroTik
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

        // Insert into database
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
            comments ?? null // Added comments here
        ]);

        // Log success
        console.log("PPPoE Client Created:", { id: result.insertId, account });

        // Respond with success
        res.status(201).json({
            success: true,
            id: result.insertId,
            message: "Client Created Successfully"
        });
        
    } catch (error) {
        // Log error details
        console.error("Error in /pppoe-clients:", error);

        res.status(500).json({
            success: false,
            message: error.message || "Internal Server Error",
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined, // Show stack trace only in development
        });
    }
});


// Get PPPoE clients with optional query parameters
router.get('/pppoe-clients', verifyToken, async (req, res) => {
    const { router_id, active, type, phone_number } = req.query;

    const company_id = req.companyId;

    let query = 'SELECT * FROM pppoe_clients WHERE 1=1';
    const params = [];

    if (company_id) {
        query += ' AND company_id = ?';
        params.push(company_id);
    }

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
        console.log(client[0].end_date);

        res.json(client[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


  // Update PPPoE client details (PATCH) with plan change and MikroTik update
  router.patch('/edit-pppoe-client/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    // Include a check here to ensure only admin/superadmin user can update clients

    // console.log(id);
    console.log("Update Client: ", updates);
  
    // Step 3: Generate dynamic SQL query for updating allowed fields only
    const allowedFields = ["sms_group", "end_date", "plan_fee", "brand", "full_name", "location", "plan_name", "plan_id", "active", "installation_fee", "comments", "phone_number"]; // <-- add only what you want to allow
    let query = "UPDATE pppoe_clients SET ";
    const params = [];

    for (const key of allowedFields) {
        if (updates[key] !== undefined) {
            query += `${key} = ?, `;
            params.push(updates[key]);
        }
    }

    // If nothing allowed is being updated
    if (params.length === 0) {
        return res.status(400).json({ message: "No valid fields provided for update" });
    }
  
    // Add timestamp and id to the query
    query = query.slice(0, -2) + ', updated_at = CURRENT_TIMESTAMP() WHERE id = ?';
    params.push(id);

    // console.log("Update Query: ", query, params);
  
    try {
      // Step 4: Execute the update query in the database
      const result = await db.execute(query, params);

      // Get Router Details
      const routerDetails = await getRouterDetails(updates.router_id);
      if (!routerDetails || !routerDetails.ip_address) {
            console.error("Error: Router Connection Impaired");
            return res.status(404).json({ error: "Router Connection Impaired" });
        }
  
      // If plan_name is being updated, call changePppoePlan
      // We no longer need to change pppoe plan since we are already changing it in the patch /pppoe-clients/:id
      if (updates.plan_name) {
            // Call changePppoePlan function and handle success/failure
            // console.log("Change Plan Requested to: ", updates.plan_name)
            const change_result = await changePppoePlan(
                routerDetails.ip_address, 
                routerDetails.username, 
                routerDetails.router_secret, 
                updates.secret, 
                updates.plan_name
            );

            if (change_result.status !== 'success') {
                return res.status(500).json({
                message: 'Client updated, but failed to change PPPoE plan.',
                affectedRows: result.affectedRows,
                error: change_result.message
                });
            }
        }

        // Update Client Status on MikroTik
        // This should only happen if we are extending the date or activating the client
        try {
            if (updates.active) {
                // Do away with the call to the microservice
                // Just run execute ssh command right here

                // Check if the client needs to be activated/deactivated on MikroTik
                const command = updates.active == 1 ? "enable" : "disable";
                /*console.log(
                    command === "enable"
                        ? "Activating Client on MikroTik as well"
                        : "Deactivating Client on MikroTik as well"
                );*/

                const mikrotikResult = await executeSSHCommand(
                    routerDetails.ip_address,
                    routerDetails.username,
                    routerDetails.router_secret,
                    updates.secret,
                    command
                );

                if (mikrotikResult.status !== 'success') {
                    console.error("Failed to enable client:", mikrotikResult.message);
                    return res.status(500).json({
                        message: "Client updated, but enabling client failed."
                    });
                } else {
                    console.log("Client successfully enabled:", mikrotikResult);
                }
            }
        } catch (error) {
            console.error("Error enabling client:", error);
            return res.status(500).json({
                message: "Client updated, but an error occurred while enabling client.",
                error: error.message
            });
        } 

      // Successful response
      return res.json({
        message: 'Client updated successfully.',
        affectedRows: result.affectedRows,
      });
  
    } catch (err) {
      // Handle database errors or other unexpected errors
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

            const { ip_address, username, router_secret } = routerDetails;

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
                    port: 22,
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

        const { ip_address, username, router_secret } = routerDetails;

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
                port: 22,
                username: username,
                password: router_secret,
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
