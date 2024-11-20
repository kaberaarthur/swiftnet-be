const express = require('express');
const db = require('../dbPromise'); // Ensure dbPromise is promise-based
const { runSSHCommand } = require('./sshCommand');

const router = express.Router();

// Promisify db.query if necessary
const queryDatabase = (query, params) => {
    return new Promise((resolve, reject) => {
        db.query(query, params, (err, results) => {
            if (err) reject(err);
            resolve(results);
        });
    });
};

// CREATE a new Hotspot Plan
router.post('/hotspot-plans', async (req, res) => {
    const {
        plan_name,
        plan_type,
        limit_type,
        data_limit,
        bandwidth,
        plan_price,
        shared_users,
        plan_validity,
        company_username,
        company_id,
        router_id,
        router_name // Added router_name
    } = req.body;

    // Format SSH command string
    const sshCommand = `/ip hotspot user profile add name=${plan_validity}hours shared-users=${shared_users} rate-limit=${bandwidth}M/${bandwidth}M`;

    try {
        // Run SSH command
        const sshOutput = await runSSHCommand(sshCommand);

        // If SSH command is successful, proceed to insert data into the database
        const query = `
            INSERT INTO hotspot_plans 
            (plan_name, plan_type, limit_type, data_limit, bandwidth, plan_price, shared_users, plan_validity, company_username, company_id, router_id, router_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const results = await queryDatabase(query, [plan_name, plan_type, limit_type, data_limit, bandwidth, plan_price, shared_users, plan_validity, company_username, company_id, router_id, router_name]);

        res.status(201).json({ message: 'Hotspot Plan created successfully!', plan_id: results.insertId });
    } catch (err) {
        // Handle SSH failure or database errors
        return res.status(500).json({ error: 'Failed to execute SSH command or insert into database: ' + err.message });
    }
});

// READ all Hotspot Plans filtered by company_id and router_id
router.get('/hotspot-plans', async (req, res) => {
    const { company_id, router_id } = req.query;

    // Dynamic SQL query with filters
    let query = `SELECT * FROM hotspot_plans WHERE 1=1`; // 1=1 allows for optional filters
    const params = [];

    if (company_id) {
        query += ` AND company_id = ?`;
        params.push(company_id);
    }

    if (router_id) {
        query += ` AND router_id = ?`;
        params.push(router_id);
    }

    try {
        const results = await queryDatabase(query, params);
        res.status(200).json(results);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// READ a single Hotspot Plan by ID
router.get('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM hotspot_plans WHERE id = ?`;

    try {
        const results = await queryDatabase(query, [id]);
        if (results.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });
        res.status(200).json(results[0]);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// UPDATE a Hotspot Plan by ID
router.put('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;
    const {
        plan_name,
        plan_type,
        limit_type,
        data_limit,
        bandwidth,
        plan_price,
        shared_users,
        plan_validity,
        company_username,
        company_id,
        router_id,
        router_name
    } = req.body;

    const selectQuery = `SELECT * FROM hotspot_plans WHERE id = ?`;

    try {
        const results = await queryDatabase(selectQuery, [id]);
        if (results.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const currentPlan = results[0];
        let mikrotikUpdateRequired = false;
        let sshCommand = '';

        // Check if plan_name, shared_users, bandwidth, or plan_validity are being changed
        if (
            plan_name !== currentPlan.plan_name ||
            shared_users !== currentPlan.shared_users ||
            bandwidth !== currentPlan.bandwidth ||
            plan_validity !== currentPlan.plan_validity
        ) {
            mikrotikUpdateRequired = true;

            // If the plan_validity is updated, change the name on MikroTik accordingly
            const updatedPlanName = plan_validity ? `${plan_validity}hours` : currentPlan.plan_name;
            const updatedSharedUsers = shared_users || currentPlan.shared_users;
            const updatedBandwidth = bandwidth || currentPlan.bandwidth;

            // Format the SSH command to update the MikroTik profile
            sshCommand = `/ip hotspot user profile set [find name="${currentPlan.plan_name}"] ` +
                `name=${updatedPlanName} shared-users=${updatedSharedUsers} rate-limit=${updatedBandwidth}M/${updatedBandwidth}M`;

            console.log('Generated SSH Command:', sshCommand);
        }

        // If MikroTik needs to be updated, run the SSH command first
        if (mikrotikUpdateRequired && sshCommand) {
            const sshOutput = await runSSHCommand(sshCommand);
            if (sshOutput.includes('failure')) {
                return res.status(500).json({ error: 'Failed to update MikroTik profile' });
            }
            console.log('MikroTik profile updated successfully.');
        }

        // Proceed to update the database
        const updatedPlan = {
            plan_name: plan_name || currentPlan.plan_name,
            plan_type: plan_type || currentPlan.plan_type,
            limit_type: limit_type || currentPlan.limit_type,
            data_limit: data_limit || currentPlan.data_limit,
            bandwidth: bandwidth || currentPlan.bandwidth,
            plan_price: plan_price || currentPlan.plan_price,
            shared_users: shared_users || currentPlan.shared_users,
            plan_validity: plan_validity || currentPlan.plan_validity,
            company_username: company_username || currentPlan.company_username,
            company_id: company_id || currentPlan.company_id,
            router_id: router_id || currentPlan.router_id,
            router_name: router_name || currentPlan.router_name
        };

        const updateQuery = `
            UPDATE hotspot_plans SET 
            plan_name = ?, plan_type = ?, limit_type = ?, data_limit = ?, bandwidth = ?, plan_price = ?, 
            shared_users = ?, plan_validity = ?, company_username = ?, company_id = ?, router_id = ?, router_name = ?
            WHERE id = ?
        `;

        const updateResults = await queryDatabase(updateQuery, [
            updatedPlan.plan_name, updatedPlan.plan_type, updatedPlan.limit_type, updatedPlan.data_limit, updatedPlan.bandwidth,
            updatedPlan.plan_price, updatedPlan.shared_users, updatedPlan.plan_validity, updatedPlan.company_username,
            updatedPlan.company_id, updatedPlan.router_id, updatedPlan.router_name, id
        ]);

        if (updateResults.affectedRows === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        res.status(200).json({ message: 'Hotspot Plan updated successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE a Hotspot Plan by ID
router.delete('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;

    const selectQuery = `SELECT plan_name FROM hotspot_plans WHERE id = ?`;

    try {
        const results = await queryDatabase(selectQuery, [id]);
        if (results.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const planName = results[0].plan_name;
        const sshCommand = `/ip hotspot user profile remove [find name="${planName}"]`;

        const sshOutput = await runSSHCommand(sshCommand);
        if (sshOutput.includes('failure')) {
            return res.status(500).json({ error: 'Failed to remove MikroTik profile' });
        }

        console.log('MikroTik profile deleted successfully.');

        const deleteQuery = `DELETE FROM hotspot_plans WHERE id = ?`;
        const deleteResults = await queryDatabase(deleteQuery, [id]);

        if (deleteResults.affectedRows === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        res.status(200).json({ message: 'Hotspot Plan and MikroTik profile deleted successfully' });
    } catch (err) {
        return res.status(500).json({ error: `Failed to execute SSH command or delete plan: ${err.message}` });
    }
});

module.exports = router;
