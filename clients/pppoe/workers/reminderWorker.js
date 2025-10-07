// workers/reminderWorker.js
const db = require('../../../dbPromise');
const redisClient = require("../../../services/redis");

async function flushReminderUpdates() {
  try {
    const updates = [];
    for (let i = 0; i < 1000; i++) {
      const val = await redisClient.lPop("reminder_updates");
      if (!val) break;
      updates.push(JSON.parse(val));
    }

    if (updates.length === 0) return;

    console.log(`🚀 Flushing ${updates.length} reminder updates to DB...`);

    // Prepare bulk CASE WHEN SQL for faster updates
    const ids = updates.map(u => u.customer_id);
    const cases = updates
      .map(u => `WHEN ${u.customer_id} THEN ${u.reminderValue}`)
      .join(" ");

    const sql = `
      UPDATE pppoe_clients
      SET reminder = CASE id ${cases} END
      WHERE id IN (${ids.join(",")});
    `;

    await db.query(sql);
    console.log(`✅ Updated ${updates.length} reminder statuses`);
  } catch (err) {
    console.error("❌ Error flushing reminder updates:", err);
  }
}

function startWorker() {
  // Every 5 minutes
  setInterval(flushReminderUpdates, 5 * 60 * 1000);
}

module.exports = { startWorker };
