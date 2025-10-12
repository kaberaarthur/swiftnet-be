const db = require('../../../dbPromise');
const redisClient = require("../../../services/redis");

async function updateCompanyUsage() {
  try {
    console.log("🚀 Running company usage worker...");

    // Step 1: Fetch all companies
    const [companies] = await db.query(`
      SELECT id, allowed_users, company_plan_name, company_plan_id, active
      FROM companies
    `);

    // Step 2: Fetch PPPoE user counts per company
    const [pppoeCounts] = await db.query(`
      SELECT company_id, COUNT(*) AS total_pppoe_users
      FROM pppoe_clients
      GROUP BY company_id
    `);

    // Step 3: Fetch voucher-based active customers (unique per phone)
    const [voucherCounts] = await db.query(`
      SELECT v.company_id, COUNT(DISTINCT v.customer) AS active_voucher_customers
      FROM vouchers v
      WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY v.company_id
    `);

    // Step 4: Create lookup maps
    const pppoeMap = {};
    const voucherMap = {};

    for (const row of pppoeCounts) {
      pppoeMap[row.company_id] = row.total_pppoe_users;
    }

    for (const row of voucherCounts) {
      voucherMap[row.company_id] = row.active_voucher_customers;
    }

    // Step 5: Merge all data
    const consolidated = companies.map(c => ({
      id: c.id,
      allowed_users: c.allowed_users,
      company_plan_name: c.company_plan_name,
      company_plan_id: c.company_plan_id,
      active: c.active,
      total_pppoe_users: pppoeMap[c.id] || 0,
      total_hotspot_users: voucherMap[c.id] || 0
    }));

    console.log(`✅ Consolidated usage for ${consolidated.length} companies`);

    // Step 6: Cache result in Redis (expires in 5 minutes)
    await redisClient.set(
      "company_usage_summary",
      JSON.stringify(consolidated),
      { EX: 300 }
    );

    console.log("💾 Cached company usage summary in Redis");

  } catch (err) {
    console.error("❌ Error updating company usage:", err);
  }
}

function startWorker() {
  updateCompanyUsage(); // Run immediately
  setInterval(updateCompanyUsage, 10 * 60 * 1000); // Every 5 minutes
}

module.exports = { startWorker };
