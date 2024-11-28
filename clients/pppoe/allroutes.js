const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { runSSHCommand } = require('../sshCommand');
const { Client } = require('ssh2');
const ssh = new Client();

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

// Create PPPOE User function
async function createPPPoEUser(routerIp, routerUsername, routerPassword, phoneNumber, password, planName) {
    const command = `/ppp secret add name="${phoneNumber}" password="${password}" profile="${planName}"`;

    return new Promise((resolve, reject) => {
        ssh.on('ready', () => {
            ssh.exec(command, (err, stream) => {
                if (err) {
                    ssh.end();
                    return resolve({
                        success: false,
                        error: `SSH command execution failed: ${err.message}`,
                    });
                }

                let stdout = '';
                let stderr = '';

                stream.on('data', (data) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                stream.on('close', (code, signal) => {
                    ssh.end();

                    if (stderr || stdout.toLowerCase().includes('failure') || stdout.toLowerCase().includes('input does not match')) {
                        return resolve({
                            success: false,
                            error: stderr || stdout,
                        });
                    }

                    return resolve({
                        success: true,
                        data: stdout || 'PPPoE user created successfully.',
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
};
  

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
        plan_name,
        plan_id,
        plan_fee, // Subscription Fee
        company_id,
        company_username,
        fat_no,
        active,
        rate_limit,
        type // New field for type
    } = req.body;

    // Get Router Details
    const routerDetails = await getRouterById(router_id);

    // MikroTik router credentials
    const router_ip = routerDetails.ip_address;
    const router_username = routerDetails.username;
    const router_password = routerDetails.router_secret;

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

        res.json(client[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// Update PPPoE client details (PATCH)
router.patch('/pppoe-clients/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        // Step 1: Fetch the existing client from the database
        const [clientResult] = await db.execute('SELECT * FROM pppoe_clients WHERE id = ?', [id]);

        if (!clientResult.length) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const client = clientResult[0];
        const { phone_number, router_id } = client; // Cannot edit `phone_number` (MikroTik secret name)

        // Step 2: Check if `plan_name` (profile) is being updated
        if (updates.plan_name && updates.plan_name !== client.plan_name) {
            // Step 2a: Fetch router details using `getRouterById`
            const routerDetails = await getRouterById(router_id);

            if (!routerDetails) {
                return res.status(404).json({ message: 'Router details not found for this client' });
            }

            const { ip_address, username, router_secret } = routerDetails;

            // Step 2b: Update profile in MikroTik
            const mikrotikCommand = `/ppp secret set [find name="${phone_number}"] profile="${updates.plan_name}"`;

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
