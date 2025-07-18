const db = require('../dbPromise');
const moment = require('moment-timezone');
const { getRouterDetails, createMikrotikHotspotUser } = require('./mikrotikFunctions');

async function fetchUser(customer) {
  if (!customer || typeof customer !== 'string' || customer.trim() === '') {
    return { success: false, message: 'Customer phone number is required.' };
  }

  try {
    const [rows] = await db.execute(
      'SELECT * FROM hotspot_clients WHERE phone_number = ? LIMIT 1',
      [customer.trim()]
    );

    if (rows.length === 0) {
      return { success: false, message: 'User not found.' };
    }

    return {
      success: true,
      user: rows[0]
    };
  } catch (error) {
    console.error('Error fetching user:', error);
    return { success: false, message: 'Internal server error.' };
  }
}

async function createOrUpdateUser({ phone_number, password, router_id, plan_id }) {
  if (!phone_number || !password || !router_id || !plan_id) {
    return { success: false, message: 'Missing required fields.' };
  }

  try {
    // Get the plan from hotspot_plans
    const [plans] = await db.execute(
      'SELECT * FROM hotspot_plans WHERE id = ? LIMIT 1',
      [plan_id]
    );

    if (plans.length === 0) {
      return { success: false, message: 'Plan not found.' };
    }

    const plan = plans[0];

    // Calculate service_start and service_expiry using UTC+3
    const serviceStart = moment().tz('Africa/Nairobi');
    const serviceExpiry = moment(serviceStart).add(plan.plan_validity, 'hours');

    const formattedStart = serviceStart.format('YYYY-MM-DD HH:mm:ss');
    const formattedExpiry = serviceExpiry.format('YYYY-MM-DD HH:mm:ss');

    // Check if the user exists
    const [existingUsers] = await db.execute(
      'SELECT id, password FROM hotspot_clients WHERE phone_number = ? AND router_id = ? LIMIT 1',
      [phone_number, plan.router_id]
    );

    if (existingUsers.length > 0) {
      // Update user
      const userId = existingUsers[0].id;
      const userPassword = existingUsers[0].password;

      await db.execute(
        `UPDATE hotspot_clients 
         SET router_name = ?, company_id = ?, company_username = ?, 
             plan_name = ?, plan_id = ?, plan_validity = ?, service_start = ?, service_expiry = ?
         WHERE id = ?`,
        [
          plan.router_name,
          plan.company_id,
          plan.company_username,
          plan.plan_name,
          plan.id,
          plan.plan_validity,
          formattedStart,
          formattedExpiry,
          userId
        ]
      );

      return { success: true, message: 'User updated successfully.', updated: true, userPassword: userPassword};
    } else {
      // Create new user
      await db.execute(
        `INSERT INTO hotspot_clients 
         (phone_number, password, router_id, router_name, company_id, company_username, 
          plan_name, plan_id, plan_validity, service_start, service_expiry)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          phone_number,
          password,
          plan.router_id,
          plan.router_name,
          plan.company_id,
          plan.company_username,
          plan.plan_name,
          plan.id,
          plan.plan_validity,
          formattedStart,
          formattedExpiry
        ]
      );

      // Create a user in the Mikrotik
      const routerResults = await getRouterDetails(plan.router_id);
      if (routerResults.success) {

          const the_router_ip_address = routerResults.data.ip_address;
          const the_router_username = routerResults.data.username;
          const the_router_secret = routerResults.data.router_secret;
          const the_router_port = routerResults.data.port;

          console.log(JSON.stringify({
            the_router_ip_address,
            the_router_username,
            the_router_secret,
            phone_number,
            password,
            the_router_port
          }, null, 2));

          const mikrotik_result = await createMikrotikHotspotUser(
            the_router_ip_address,
            the_router_username,
            the_router_secret,
            phone_number,
            password,
            the_router_port
          );

          if (mikrotik_result.success) {
            console.log('✅ MikroTik user created:', mikrotik_result.message);
          } else {
            console.error('❌ Failed to create MikroTik user:', mikrotik_result.message);
          }
        
      } else {
        console.error(routerResults.message);
      }

      return { success: true, message: 'User created successfully.', created: true, userPassword: password };
    }
  } catch (error) {
    console.error('Error in createOrUpdateUser:', error);
    return { success: false, message: 'Database error.' };
  }
}

module.exports = {
    fetchUser,
    createOrUpdateUser
};