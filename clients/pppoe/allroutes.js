const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { runSSHCommand } = require('../sshCommand');
const { Client } = require('ssh2');
const ssh = new Client();
const axios = require('axios');

// A function to get the Mikrotik Details Dynamically
// Include a check to see whether that router belongs to the company of the registered user
const getRouterById = async (id) => {  
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


  // Function to create a PPPoE user
async function createPPPoEUser(routerIp, routerUsername, routerPassword, phoneNumber, password, planName) {
    const command = `/ppp secret add name="${phoneNumber}" password="${password}" profile="${planName}"`;

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
  
// Add code to get Plan Details from DB
// Create a new PPPoE client
router.post('/pppoe-clients', async (req, res) => {
    const {
        account,
        full_name,
        email,
        password,
        address,
        phone_number,
        payment_no,
        sms_group,
        installation_fee,
        router_id,
        plan_id,
        company_id,
        company_username,
        fat_no,
        active,
        rate_limit,
        type // New field for type
    } = req.body;

    // Get Router Details
    const router_id_no = Number(router_id);
    const routerDetails = await getRouterById(router_id_no);

    // MikroTik router credentials
    const router_ip = routerDetails.ip_address;
    const router_username = routerDetails.username;
    const router_password = routerDetails.router_secret;

    const planDetails = await getPlanDetails(plan_id);
    // console.log("Plan Details: ", planDetails);

    const plan_name = planDetails.plan_name;
    const plan_fee = parseFloat(planDetails.plan_price);


    try {
        // Run the function to create a user on MikroTik
        const createUserResponse = await createPPPoEUser(
            router_ip,
            router_username,
            router_password,
            phone_number,
            password,
            plan_name
        );

        if (createUserResponse.success) {
            // Insert into the PPPoE clients database if the MikroTik command is successful
            const query = `
                INSERT INTO pppoe_clients (
                    account, full_name, email, password, address, phone_number, 
                    payment_no, sms_group, installation_fee, router_id, plan_name, 
                    plan_id, plan_fee, company_id, company_username, fat_no, active, rate_limit, type, 
                    start_date, end_date, date_created
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`;

            const result = await db.execute(query, [
                account, full_name, email, password, address, phone_number,
                payment_no, sms_group, installation_fee, router_id, plan_name,
                plan_id, plan_fee, company_id, company_username, fat_no, active, rate_limit, type
            ]);

            // Respond with success and the new record's ID
            res.status(201).json({
                success: true,
                id: result.insertId,
            });
        } else {
            res.status(400).json({
                success: false,
                error: `Error creating user in Mikrotik`,
            });
        }
    } catch (error) {
        // Handle errors
        res.status(500).json({ message: error.message });
    }
});


// Get PPPoE clients with optional query parameters
router.get('/pppoe-clients', async (req, res) => {
    const { company_id, router_id, active, type, phone_number } = req.query;
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


// Get a single PPPoE client by ID
router.get('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [client] = await db.execute('SELECT * FROM pppoe_clients WHERE id = ?', [id]);

        if (client.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }
        console.log(client[0].end_date);

        res.json(client[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// Send to Microservice
async function changePppoePlan(secret_name, new_plan, router, customer_id) {
    const url = 'http://localhost:3001/api/change-pppoe-plan';
  
    const requestBody = {
      secret_name,
      new_plan,
      router,
      customer_id
    };
  
    console.log(secret_name,
        new_plan,
        router,
        customer_id);

    try {
      const response = await axios.post(url, requestBody);
      console.log('Response:', response.data);
      return { status: 'success', message: 'Plan changed successfully' };  // Return success
    } catch (error) {
      console.error('Error making request:', error);
      // Customize error message based on error response
      if (error.response) {
        // Request made and server responded with a status other than 2xx
        return { status: 'failure', message: `Microservice error: ${error.response.data || error.response.statusText}` };
      } else if (error.request) {
        // Request made but no response received
        return { status: 'failure', message: 'No response received from microservice' };
      } else {
        // Something went wrong in setting up the request
        return { status: 'failure', message: `Error: ${error.message}` };
      }
    }
  }
  
  router.patch('/edit-pppoe-client/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
  
    // console.log(id);
    console.log("New End Date: ", updates.end_date);
  
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
  
    try {
      // Step 4: Execute the update query in the database
      const result = await db.execute(query, params);
  
      // Call changePppoePlan function and handle success/failure
      const change_result = await changePppoePlan(updates.secret, updates.plan_name, updates.router_id, id);
  
      if (change_result.status === 'failure') {
        return res.status(500).json({
          message: 'Client updated, but failed to change PPPoE plan.',
          affectedRows: result.affectedRows,
          error: change_result.message
        });
      }
  
      // Successful response
      return res.json({
        message: 'Client updated and plan changed successfully.',
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


// Delete a PPPoE client
router.delete('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Step 1: Fetch the PPPoE client from the database to get `phone_number` and `router_id`
        const [clientResult] = await db.execute('SELECT phone_number, router_id FROM pppoe_clients WHERE id = ?', [id]);

        if (clientResult.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const { phone_number, router_id } = clientResult[0];

        // Step 2: Fetch router details using `getRouterById`
        const routerDetails = await getRouterById(router_id);

        if (!routerDetails) {
            return res.status(404).json({ message: 'Router details not found for this client' });
        }

        const { ip_address, username, router_secret } = routerDetails;

        // Step 3: Run the SSH command to remove the PPPoE client from MikroTik
        const mikrotikCommand = `/ppp secret remove [find name="${phone_number}"]`;

        const ssh = new Client();
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
            return res.status(500).json({ message: `Error removing client from MikroTik: ${sshResult.error}` });
        }

        // Step 4: If the SSH command is successful, delete the client from the database
        const result = await db.execute('DELETE FROM pppoe_clients WHERE id = ?', [id]);

        // Step 5: Send the response with the number of affected rows (should be 1 if successful)
        res.json({ message: 'Client deleted', affectedRows: result.affectedRows });
    } catch (error) {
        // If any error occurs (SSH command or DB operation), return an error response
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
