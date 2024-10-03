const express = require('express');
const router = express.Router();
const db = require('../../dbPromise');
const { runSSHCommand } = require('../sshCommand');

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
        plan_name, // Replacing service_plan_id with plan_name
        company_id,
        company_username,
        fat_no,
        active,
        end_date,
        rate_limit
    } = req.body;

    try {
        // Step 1: Execute the MikroTik command to add a PPPoE secret
        const mikrotikCommand = `/ppp secret add name="${phone_number}" password="${password}" service="pppoe" profile="${plan_name}"`;

        // console.log("Mikrotik Command: ", mikrotikCommand);
        
        await runSSHCommand(mikrotikCommand); // Run the SSH command

        // Step 2: Insert into the PPPoE clients database if the MikroTik command is successful
        const query = `
            INSERT INTO pppoe_clients (
                account, full_name, email, password, address, phone_number, 
                payment_no, sms_group, installation_fee, router_id, plan_name, 
                company_id, company_username, fat_no, active, end_date, rate_limit, date_created
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP())`;

        const result = await db.execute(query, [
            account, full_name, email, password, address, phone_number, 
            payment_no, sms_group, installation_fee, router_id, plan_name, 
            company_id, company_username, fat_no, active, end_date, rate_limit
        ]);

        res.status(201).json({ id: result.insertId });
    } catch (error) {
        // If there is an error (either SSH command or DB insertion), return an error response
        res.status(500).json({ message: error.message });
    }
});


// Get PPPoE clients with optional query parameters
router.get('/pppoe-clients', async (req, res) => {
    const { company_id, router_id, active } = req.query;
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

    try {
        const [clients] = await db.execute(query, params);
        res.json(clients);
    } catch (error) {
        res.status(500).json({ message: error.message });
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
        const { phone_number } = client;  // Cannot edit the phone_number (MikroTik secret name)

        // Step 2: Check if `plan_name` (profile) is being updated
        let updateProfileOnMikrotik = false;
        if (updates.plan_name && updates.plan_name !== client.plan_name) {
            updateProfileOnMikrotik = true;
        }

        // Step 3: Run SSH command to update profile in MikroTik if required
        if (updateProfileOnMikrotik) {
            const mikrotikCommand = `/ppp secret set [find name="${phone_number}"] profile="${updates.plan_name}"`;
            // console.log(mikrotikCommand);
            await runSSHCommand(mikrotikCommand);  // Update MikroTik secret profile
        }

        // Step 4: Generate dynamic SQL query for updating other fields
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

        // Step 5: Execute the update query in the database
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
        // Step 1: Fetch the PPPoE client from the database to get the `phone_number` (used as the MikroTik secret)
        const [clientResult] = await db.execute('SELECT phone_number FROM pppoe_clients WHERE id = ?', [id]);

        if (clientResult.length === 0) {
            return res.status(404).json({ message: 'Client not found' });
        }

        const { phone_number } = clientResult[0];

        // Step 2: Run the SSH command to remove the PPPoE client from MikroTik
        const mikrotikCommand = `/ppp secret remove [find name="${phone_number}"]`;
        await runSSHCommand(mikrotikCommand);

        // Step 3: If the SSH command is successful, delete the client from the database
        const result = await db.execute('DELETE FROM pppoe_clients WHERE id = ?', [id]);

        // Step 4: Send the response with the number of affected rows (should be 1 if successful)
        res.json({ message: 'Client deleted', affectedRows: result.affectedRows });
    } catch (error) {
        // If any error occurs (SSH command or DB operation), return an error response
        res.status(500).json({ message: error.message });
    }
});


module.exports = router;
