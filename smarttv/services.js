const db = require('../dbPromise');
const moment = require('moment-timezone');

async function redeemVoucher(code_voucher) {
  try {
    // 🔹 Fetch voucher
    const [rows] = await db.execute(
      `SELECT id, plan_validity, redeemed, plan_id, customer, router_id, total_users, current_users, start_date, end_date
       FROM vouchers WHERE code_voucher = ? LIMIT 1`,
      [code_voucher.trim()]
    );

    if (!rows.length) {
      return { success: false, message: 'Voucher not found.' };
    }

    const voucher = rows[0];

    // 🔹 Check users limit
    if (voucher.current_users >= voucher.total_users) {
      return { success: false, message: 'Voucher has reached its maximum number of users.' };
    }

    const now = moment().tz('Africa/Nairobi');

    let startDate, endDate;

    // 🔹 Case 1: first-time use (dates are null)
    if (!voucher.start_date || !voucher.end_date) {
      const start = now.clone();
      const end = start.clone().add(voucher.plan_validity, 'hours');
      [startDate, endDate] = [start, end].map(d => d.format('YYYY-MM-DD HH:mm:ss'));

      await db.execute(
        `UPDATE vouchers 
         SET redeemed = 1, start_date = ?, end_date = ?, current_users = current_users + 1 
         WHERE id = ?`,
        [startDate, endDate, voucher.id]
      );

      // Update voucher object in memory
      voucher.start_date = startDate;
      voucher.end_date = endDate;

    } else {
      // 🔹 Case 2: already has start_date/end_date → check if expired
      const expiry = moment.tz(voucher.end_date, 'YYYY-MM-DD HH:mm:ss', 'Africa/Nairobi');
      if (now.isAfter(expiry)) {
        return { success: false, message: 'Voucher has already expired.' };
      }

      // Not expired → just increment users
      await db.execute(
        `UPDATE vouchers 
         SET redeemed = 1, current_users = current_users + 1 
         WHERE id = ?`,
        [voucher.id]
      );

      // Keep existing dates in voucher object
      startDate = voucher.start_date;
      endDate = voucher.end_date;
    }

    return {
      success: true,
      message: 'Voucher redeemed successfully. TV Access Granted.',
      voucher: {
        ...voucher,
        start_date: startDate,
        end_date: endDate,
        current_users: voucher.current_users + 1  // increment in returned object
      }
    };

  } catch (err) {
    console.error(err);
    return { success: false, message: err.message };
  }
}

async function getRouterByID(router_id) {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM routers WHERE id = ? LIMIT 1',
      [router_id]
    );

    if (rows.length > 0) {
      // console.log("Router found:", rows[0]);
      return { success: true, data: rows[0] };
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching router:', error);
    throw error;
  }
}

module.exports = {
  redeemVoucher,
  getRouterByID
};