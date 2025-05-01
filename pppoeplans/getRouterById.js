const db = require('../dbPromise');

/**
 * Get a router by ID from the 'routers' table.
 * @param {number} id - The unique ID of the router to retrieve.
 * @returns {Promise<object>} JSON object with router data or a message if not found.
 */

async function getRouterById(id) {
    try {
        const [rows] = await db.execute('SELECT * FROM routers WHERE id = ?', [id]);

        if (rows.length === 0) {
            return { success: false, message: `No router found with ID ${id}` };
        }

        return { success: true, data: rows[0] };
    } catch (error) {
        console.error('Database error:', error);
        return { success: false, message: 'Database query failed', error: error.message };
    }
}

module.exports = getRouterById;
