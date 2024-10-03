const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { findUnusedIPs } = require('../../unusedIPFunction');
const { runSSHCommand } = require('../sshCommand');

// Create a new Static client
router.post('/static-clients', async (req, res) => {
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
        plan_name, // Plan name instead of service_plan_id
        company_id,
        company_username,
        fat_no,
        active,
        end_date,
        rate_limit,
        pool_range // Include pool_range as part of the request data
    } = req.body;

    try {
        // Step 1: Get an unused IP address from the specified IP pool range
        const unusedIPs = await findUnusedIPs(pool_range); // Use pool_range as the parameter

        if (!unusedIPs || unusedIPs.length === 0) {
            return res.status(500).json({ message: 'No IP addresses available in the pool' });
        }

        // Select a random IP address from the available pool
        const remote_address = unusedIPs[Math.floor(Math.random() * unusedIPs.length)];
        // console.log("Remote Address: ", remote_address);

        // Step 2: Execute the MikroTik command to add a static client
        const mikrotikCommand = `/ppp secret add name="${phone_number}" password="${password}" service="pppoe" profile="${plan_name}" remote-address="${remote_address}"`;

        // console.log("Mikrotik Command: ", mikrotikCommand);
        await runSSHCommand(mikrotikCommand); // Run the SSH command

        // Step 3: Insert into the static clients database if the MikroTik command is successful
        const query = `
            INSERT INTO static_clients (
                account, full_name, email, password, address, phone_number, 
                payment_no, sms_group, installation_fee, router_id, plan_name, 
                company_id, company_username, fat_no, active, end_date, rate_limit, 
                remote_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await db.execute(query, [
            account, full_name, email, password, address, phone_number, 
            payment_no, sms_group, installation_fee, router_id, plan_name, 
            company_id, company_username, fat_no, active, end_date, rate_limit, remote_address
        ]);

        res.status(201).json({ id: result.insertId });
    } catch (error) {
        // If there is an error (either SSH command or DB insertion), return an error response
        res.status(500).json({ message: error.message });
    }
});

// Get Static clients with optional query parameters
router.get('/static-clients', async (req, res) => {
    const { company_id, router_id, active } = req.query;
    let query = 'SELECT * FROM static_clients WHERE 1=1';
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

    try {
        const [clients] = await db.execute(query, params);
        res.json(clients);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get a single Static client by ID
router.get('/static-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [client] = await db.execute('SELECT * FROM static_clients WHERE id = ?', [id]);

        if (client.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        res.json(client[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Update Static client details (PATCH)
router.patch('/static-clients/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        // Step 1: Fetch the existing client from the database
        const [clientResult] = await db.execute('SELECT * FROM static_clients WHERE id = ?', [id]);

        if (!clientResult.length) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const client = clientResult[0];
        const { phone_number } = client; // Cannot edit the phone_number (MikroTik secret name)

        // Step 2: Check if `plan_name` (profile) is being updated
        let updateProfileOnMikrotik = false;
        if (updates.plan_name && updates.plan_name !== client.plan_name) {
            updateProfileOnMikrotik = true;
            // console.log("Mikrotik Update*")
        }

        // Step 3: Run SSH command to update profile in MikroTik if required
        if (updateProfileOnMikrotik) {
            const mikrotikCommand = `/ppp secret set [find name="${phone_number}"] profile="${updates.plan_name}"`;
            // console.log(mikrotikCommand);
            await runSSHCommand(mikrotikCommand); // Update MikroTik secret profile
        }

        // Step 4: Generate dynamic SQL query for updating other fields
        let query = 'UPDATE static_clients SET ';
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

        // Step 5: Execute the update query in the database
        const result = await db.execute(query, params);

        res.json({ message: 'Client updated', affectedRows: result.affectedRows });

    } catch (error) {
        // Error handling
        res.status(500).json({ message: error.message });
    }
});

// Delete a Static client
router.delete('/static-clients/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // Step 1: Fetch the Static client details from the database
        const [clientResult] = await db.execute('SELECT phone_number FROM static_clients WHERE id = ?', [id]);

        if (clientResult.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const { phone_number } = clientResult[0]; // This is the MikroTik "hotspot" user (name)

        // Step 2: Run the SSH command to remove the static client from MikroTik
        const mikrotikCommand = `/ip hotspot user remove [find name="${phone_number}"]`;
        await runSSHCommand(mikrotikCommand);

        // Step 3: If the SSH command is successful, delete the client from the database
        const result = await db.execute('DELETE FROM static_clients WHERE id = ?', [id]);

        // Step 4: Send the response with the number of affected rows (should be 1 if successful)
        res.json({ message: 'Client deleted', affectedRows: result.affectedRows });
    } catch (error) {
        // If any error occurs (either SSH command or DB operation), return an error response
        res.status(500).json({ message: error.message });
    }
});


module.exports = router;
