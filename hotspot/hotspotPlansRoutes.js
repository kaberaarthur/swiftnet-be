const express = require('express');
const db = require('../dbPromise'); // Ensure dbPromise is promise-based
const { runSSHCommand } = require('./sshCommand');

const router = express.Router();

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
        router_name
    } = req.body;

    const sshCommand = `/ip hotspot user profile add name=${plan_validity}hours shared-users=${shared_users} rate-limit=${bandwidth}M/${bandwidth}M`;

    try {
        // Run SSH command
        const sshOutput = await runSSHCommand(sshCommand);

        if (sshOutput.includes('failure')) {
            return res.status(500).json({ error: 'Failed to execute SSH command' });
        }

        const query = `
            INSERT INTO hotspot_plans 
            (plan_name, plan_type, limit_type, data_limit, bandwidth, plan_price, shared_users, plan_validity, company_username, company_id, router_id, router_name) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [results] = await db.execute(query, [
            plan_name, plan_type, limit_type, data_limit, bandwidth, plan_price,
            shared_users, plan_validity, company_username, company_id, router_id, router_name
        ]);

        res.status(201).json({ message: 'Hotspot Plan created successfully!', plan_id: results.insertId });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to execute SSH command or insert into database: ' + err.message });
    }
});

// READ all Hotspot Plans filtered by company_id and router_id
router.get('/hotspot-plans', async (req, res) => {
    const { company_id, router_id } = req.query;

    let query = `SELECT * FROM hotspot_plans WHERE 1=1`;
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
        const [results] = await db.execute(query, params);
        res.status(200).json(results);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// READ a single Hotspot Plan by ID
router.get('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [results] = await db.execute(`SELECT * FROM hotspot_plans WHERE id = ?`, [id]);
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

    try {
        const [existingPlans] = await db.execute(`SELECT * FROM hotspot_plans WHERE id = ?`, [id]);
        if (existingPlans.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const currentPlan = existingPlans[0];
        let sshCommand = '';

        if (
            plan_name !== currentPlan.plan_name ||
            shared_users !== currentPlan.shared_users ||
            bandwidth !== currentPlan.bandwidth ||
            plan_validity !== currentPlan.plan_validity
        ) {
            const updatedPlanName = plan_validity ? `${plan_validity}hours` : currentPlan.plan_name;
            sshCommand = `/ip hotspot user profile set [find name="${currentPlan.plan_name}"] ` +
                `name=${updatedPlanName} shared-users=${shared_users || currentPlan.shared_users} rate-limit=${bandwidth || currentPlan.bandwidth}M/${bandwidth || currentPlan.bandwidth}M`;

            const sshOutput = await runSSHCommand(sshCommand);
            if (sshOutput.includes('failure')) {
                return res.status(500).json({ error: 'Failed to update MikroTik profile' });
            }
        }

        const updateQuery = `
            UPDATE hotspot_plans SET 
            plan_name = ?, plan_type = ?, limit_type = ?, data_limit = ?, bandwidth = ?, plan_price = ?, 
            shared_users = ?, plan_validity = ?, company_username = ?, company_id = ?, router_id = ?, router_name = ?
            WHERE id = ?
        `;

        await db.execute(updateQuery, [
            plan_name || currentPlan.plan_name,
            plan_type || currentPlan.plan_type,
            limit_type || currentPlan.limit_type,
            data_limit || currentPlan.data_limit,
            bandwidth || currentPlan.bandwidth,
            plan_price || currentPlan.plan_price,
            shared_users || currentPlan.shared_users,
            plan_validity || currentPlan.plan_validity,
            company_username || currentPlan.company_username,
            company_id || currentPlan.company_id,
            router_id || currentPlan.router_id,
            router_name || currentPlan.router_name,
            id
        ]);

        res.status(200).json({ message: 'Hotspot Plan updated successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// DELETE a Hotspot Plan by ID
router.delete('/hotspot-plans/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [existingPlans] = await db.execute(`SELECT plan_name FROM hotspot_plans WHERE id = ?`, [id]);
        if (existingPlans.length === 0) return res.status(404).json({ message: 'Hotspot Plan not found' });

        const sshCommand = `/ip hotspot user profile remove [find name="${existingPlans[0].plan_name}"]`;
        const sshOutput = await runSSHCommand(sshCommand);

        if (sshOutput.includes('failure')) {
            return res.status(500).json({ error: 'Failed to remove MikroTik profile' });
        }

        await db.execute(`DELETE FROM hotspot_plans WHERE id = ?`, [id]);

        res.status(200).json({ message: 'Hotspot Plan and MikroTik profile deleted successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
