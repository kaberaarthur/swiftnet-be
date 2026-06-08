const express = require('express');
const router = express.Router();
const db = require('../dbPromise');
const { verifyToken } = require('../systemFunctions');

// CREATE a new brand
router.post('/brands', verifyToken, async (req, res) => {
    const { name} = req.body;
    const user_company_id = req.company_id;

    if (!name ) {
        return res.status(400).json({ message: 'name and company_id are required' });
    }

    try {
        const [result] = await db.execute(
            'INSERT INTO brands (name, company_id) VALUES (?, ?)',
            [name, user_company_id]
        );
        res.status(201).json({ id: result.insertId, name, user_company_id });
    } catch (error) {
        console.error('Error creating brand:', error);
        res.status(500).json({ error: 'Failed to create brand' });
    }
});

// READ all brands for the authenticated user's company
router.get('/brands', verifyToken, async (req, res) => {
    const user_company_id = req.company_id;

    try {
        const [rows] = await db.execute('SELECT * FROM brands WHERE company_id = ?', [user_company_id]);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching brands:', error);
        res.status(500).json({ error: 'Failed to fetch brands' });
    }
});

router.get('/brands/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const user_company_id = req.company_id;

    try {
        const [rows] = await db.execute(
            'SELECT * FROM brands WHERE id = ? AND company_id = ?',
            [id, user_company_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Brand not found or access denied' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching brand:', error);
        res.status(500).json({ error: 'Failed to fetch brand' });
    }
});

router.patch('/brands/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const user_company_id = req.company_id;

    if (!name) {
        return res.status(400).json({ message: 'Name is required for update' });
    }

    try {
        // Check ownership
        const [check] = await db.execute(
            'SELECT * FROM brands WHERE id = ? AND company_id = ?',
            [id, user_company_id]
        );

        if (check.length === 0) {
            return res.status(404).json({ message: 'Brand not found or access denied' });
        }

        // Proceed with update
        const [result] = await db.execute(
            'UPDATE brands SET name = ? WHERE id = ? AND company_id = ?',
            [name, id, user_company_id]
        );

        res.json({ message: 'Brand updated successfully' });
    } catch (error) {
        console.error('Error updating brand:', error);
        res.status(500).json({ error: 'Failed to update brand' });
    }
});

router.delete('/brands/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const user_company_id = req.company_id;

    try {
        // Check ownership first
        const [check] = await db.execute(
            'SELECT * FROM brands WHERE id = ? AND company_id = ?',
            [id, user_company_id]
        );

        if (check.length === 0) {
            return res.status(404).json({ message: 'Brand not found or access denied' });
        }

        // Proceed with delete
        const [result] = await db.execute(
            'DELETE FROM brands WHERE id = ? AND company_id = ?',
            [id, user_company_id]
        );

        res.json({ message: 'Brand deleted successfully' });
    } catch (error) {
        console.error('Error deleting brand:', error);
        res.status(500).json({ error: 'Failed to delete brand' });
    }
});


module.exports = router;
