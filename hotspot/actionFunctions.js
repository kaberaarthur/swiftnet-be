const db = require('../dbPromise');
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_SECRET;
const moment = require('moment-timezone');


async function getPlanDetails(plan_id) {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM hotspot_plans WHERE id = ?',
      [plan_id]
    );

    if (rows.length > 0) {
      return rows[0]; // Return the plan as JSON
    } else {
      return null; // Not found
    }
  } catch (error) {
    console.error('Error fetching plan details:', error);
    throw error; // Let caller handle
  }
}


async function deleteOldRedeemedVouchers() {
  try {
    // Delete rows where redeemed = 1 and end_date passed 7 days ago
    const [result] = await db.execute(
      `DELETE FROM vouchers 
       WHERE redeemed = 1 
       AND end_date < NOW() - INTERVAL 7 DAY`
    );

    console.log(`${result.affectedRows} old redeemed voucher(s) deleted.`);
    return { success: true, deleted: result.affectedRows };
  } catch (error) {
    console.error('Error deleting old redeemed vouchers:', error);
    return { success: false, message: 'Database error', error };
  }
}

// Middleware to verify token
function verifyToken(req, res, next) {
    // Extract the token from the Authorization header
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    // Extract the token from the 'Authorization' header
    const bearerToken = token.split(' ')[1];

    
    // Verify the token
    jwt.verify(bearerToken, jwtSecret, (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }

        // Attach the user ID to the request object
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.companyId = decoded.company_id;
        next();
    });
    
};


// Character set for passwords and vouchers
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const charLength = characters.length;

// Function to generate a 6-character password
function generatePassword() {
    let password = '';
    for (let i = 0; i < 6; i++) {
        const randomIndex = Math.floor(Math.random() * charLength);
        password += characters[randomIndex];
    }
    return password;
}

// Function to generate an 8-character unique voucher
async function generateUniqueVoucher(maxRetries = 5) {
    let retries = 0;
    while (retries < maxRetries) {
        let voucher = '';
        for (let i = 0; i < 8; i++) {
            const randomIndex = Math.floor(Math.random() * charLength);
            voucher += characters[randomIndex];
        }

        try {
            // Check if voucher exists in the database
            const [existing] = await db.query('SELECT code_voucher FROM vouchers WHERE code_voucher = ?', [voucher]);
            if (existing.length === 0) {
                return voucher;
            }
            // Voucher exists, retry
            retries++;
        } catch (error) {
            throw new Error(`Database error: ${error.message}`);
        }
    }
    throw new Error('Max retries reached. Could not generate a unique voucher.');
}

// Main function to create a voucher
async function createVoucher(plan_id, customer) {
    try {
        // Query to select plan details
        const [rows] = await db.execute(
            'SELECT company_id, router_id, company_username, plan_name, plan_validity, plan_price, shared_users FROM hotspot_plans WHERE id = ?',
            [plan_id]
        );

        // Check if plan exists
        if (rows.length === 0) {
            throw new Error('Plan not found');
        }

        const plan = rows[0];
        
        // Generate unique voucher
        const voucherCode = await generateUniqueVoucher();
        console.log('Generated voucher code:', voucherCode);
        
        // Insert voucher into database
        const [result] = await db.execute(
            'INSERT INTO vouchers (code_voucher, plan_id, company_id, router_id, company_username, plan_name, plan_validity, customer, total_users, current_users, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                voucherCode,
                plan_id,
                plan.company_id,
                plan.router_id,
                plan.company_username,
                plan.plan_name,
                plan.plan_validity,
                customer,
                plan.shared_users,
                0, // current_users is initially 0
                plan.plan_price,
            ]
        );

        // Return voucher details
        return {
            success: true,
            voucher_code: voucherCode,
            plan_id,
            company_id: plan.company_id,
            router_id: plan.router_id,
            company_username: plan.company_username,
            plan_name: plan.plan_name,
            plan_validity: plan.plan_validity,
            voucher_id: result.insertId,
            customer: customer,
        };

    } catch (error) {
        console.error('Error creating voucher:', error);
        return {
            success: false,
            error: error.message,
            message: error.message
        };
    }
};

async function handleHotspotClient(router_id, phone_number, password, createVoucherResult) {
  try {
    const customer = phone_number;
    const { plan_id, plan_validity, plan_name, company_id, router_id, company_username } = createVoucherResult;
    
    // Ensure Nairobi timestamp
    const serviceStart = moment().tz('Africa/Nairobi');
    const serviceExpiry = moment(serviceStart).add(plan_validity, 'hours');

    // Format to MySQL DATETIME
    const formattedStart = serviceStart.format('YYYY-MM-DD HH:mm:ss');
    const formattedExpiry = serviceExpiry.format('YYYY-MM-DD HH:mm:ss');

    // Check if user exists
    const [rows] = await db.execute(
      'SELECT id FROM hotspot_clients WHERE phone_number = ? AND router_id = ?',
      [phone_number, router_id]
    );

    if (rows.length > 0) {
      // User exists, do update
      await db.execute(
        `UPDATE hotspot_clients 
         SET password = ?, 
             service_start = ?, 
             service_expiry = ?, 
             plan_id = ?, 
             plan_validity = ?, 
             plan_name = ?
         WHERE phone_number = ? AND router_id = ?`,
        [password, formattedStart, formattedExpiry, plan_id, plan_validity, plan_name, phone_number, router_id]
      );

      return { success: true, message: 'Hotspot client updated successfully.' };
    } else {
      // User doesn't exist, insert new
      await db.execute(
        `INSERT INTO hotspot_clients 
         (phone_number, router_id, password, service_start, service_expiry, plan_id, plan_validity, plan_name, company_id, company_username) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          phone_number,
          router_id,
          password,
          formattedStart,
          formattedExpiry,
          plan_id,
          plan_validity,
          plan_name,
          company_id,
          company_username
        ]
      );

      return { success: true, message: 'Hotspot client created successfully.' };
    }
  } catch (error) {
    console.error('DB Error:', error);
    return { success: false, message: 'Database operation failed.', error: error.message };
  }
}

// Finally fill the transaction row with the customer's details
async function finalizePaymentById(mpesa_transaction_id, phone_number, createVoucherResult) {
  try {
    // Validate input parameters
    if (!mpesa_transaction_id || !phone_number || !createVoucherResult) {
      console.error('Invalid inputs to updatePaymentById:', { id, phone_number, createVoucherResult });
      return { success: false, message: 'Missing required parameters: id, phone_number, or createVoucherResult' };
    }

    // Destructure createVoucherResult with defaults to prevent undefined values
    const {
      plan_id = null,
      company_id = null,
      router_id = null,
      company_username = null,
      plan_name = null,
      plan_validity = null,
      customer = null
    } = createVoucherResult;

    // Validate required fields
    if (!plan_id || !company_id || !router_id || !plan_name || !plan_validity) {
      console.error('Missing required properties in createVoucherResult:', createVoucherResult);
      return {
        success: false,
        message: 'Invalid createVoucherResult: missing plan_id, company_id, router_id, plan_name, or plan_validity'
      };
    }

    // Ensure phone_number matches customer (optional, depending on your logic)
    if (customer && customer !== phone_number) {
      console.warn('Mismatch between phone_number and createVoucherResult.customer:', { phone_number, customer });
      // You can decide whether to proceed or return an error
    }

    // Get current timestamp in Nairobi and calculate end_date
    const start_date = moment().tz('Africa/Nairobi');
    const end_date = moment(start_date).add(plan_validity, 'hours');

    // Log parameters for debugging
    console.log('updatePaymentById params:', {
      mpesa_transaction_id,
      phone_number,
      company_id,
      company_username,
      router_id,
      plan_id,
      plan_name,
      plan_validity,
      start_date,
      end_date
    });

    // Assuming db is a configured mysql2 connection pool
    const [result] = await db.execute(
      `UPDATE payments
       SET company_id = ?,
           company_username = ?,
           router_id = ?,
           plan_id = ?,
           plan_name = ?,
           plan_validity = ?,
           phone_number = ?,
           usedStatus = ?,
           start_date = ?,
           end_date = ?
       WHERE id = ?`,
      [
        company_id,
        company_username ?? null, // Use null for optional field
        router_id,
        plan_id,
        plan_name,
        plan_validity,
        phone_number,
        "used",
        start_date.format('YYYY-MM-DD HH:mm:ss'),
        end_date.format('YYYY-MM-DD HH:mm:ss'),
        mpesa_transaction_id
      ]
    );

    // Check if any rows were updated
    if (result.affectedRows === 0) {
      console.warn(`No payment record found for id: ${id}`);
      /*return { success: false, message: `No payment record found with id: ${id}` };*/
    }

    /*
    return {
      success: true,
      message: `Payment record with id ${id} updated successfully`,
      affectedRows: result.affectedRows
    };
    */
  } catch (error) {
    console.error('Error in updatePaymentById:', error);

    /*
    return {
      success: false,
      message: `Database operation failed: ${error.message}`
    };
    */
  }
}

async function finalizeVoucherCodeById(id) {
  try {
    // Validate input parameter
    if (!id) {
      console.error('Invalid input to finalizeVoucherCodeById:', { id });
      return { success: false, message: 'Missing required parameter: id' }; // Optional return for debugging
    }

    // Fetch plan_validity from vouchers table
    let voucherRows;
    try {
      [voucherRows] = await db.execute(
        `SELECT plan_validity FROM vouchers WHERE id = ? LIMIT 1`,
        [id]
      );
    } catch (dbError) {
      console.error(`Database error querying vouchers table for id: ${id}`, dbError);
      return { success: false, message: `Database error while querying voucher: ${dbError.message}` }; // Optional return
    }

    if (!voucherRows || voucherRows.length === 0) {
      console.warn(`No voucher record found for id: ${id}`);
      return { success: false, message: `No voucher record found with id: ${id}` }; // Optional return
    }

    const plan_validity = voucherRows[0].plan_validity;

    // Validate plan_validity
    if (!plan_validity || typeof plan_validity !== 'number') {
      console.error('Invalid or missing plan_validity for voucher id:', id, { plan_validity });
      return { success: false, message: 'Invalid or missing plan_validity in voucher record' }; // Optional return
    }

    // Get current timestamp in Nairobi and calculate end_date
    const start_date = moment().tz('Africa/Nairobi');
    const end_date = moment(start_date).add(plan_validity, 'hours');

    // Log parameters for debugging
    console.log('finalizeVoucherCodeById params:', {
      id,
      plan_validity,
      start_date: start_date.format(),
      end_date: end_date.format(),
      redeemed: 1
    });

    // Update vouchers table with start_date, end_date, redeemed, and increment current_users
    const [result] = await db.execute(
      `UPDATE vouchers
      SET start_date = ?,
          end_date = ?,
          redeemed = ?,
          current_users = current_users + 1
      WHERE id = ?`,
      [
        start_date.format('YYYY-MM-DD HH:mm:ss'), // Format for MySQL DATETIME/TIMESTAMP
        end_date.format('YYYY-MM-DD HH:mm:ss'),
        1, // Set redeemed to 1
        id
      ]
    );

    // Check if any rows were updated
    if (result.affectedRows === 0) {
      console.warn(`No voucher record updated for id: ${id}`);
      // return { success: false, message: `No voucher record updated with id: ${id}` }; // Optional return
    }

    // Optional return for debugging
    // return {
    //   success: true,
    //   message: `Voucher record with id ${id} updated successfully`,
    //   affectedRows: result.affectedRows
    // };
  } catch (error) {
    console.error('Error in finalizeVoucherCodeById:', error);
    // return {
    //   success: false,
    //   message: `Database operation failed: ${error.message}`
    // }; // Optional return
  }
}

module.exports = {
    getPlanDetails,
    deleteOldRedeemedVouchers,
    verifyToken,
    generatePassword,
    generateUniqueVoucher,
    createVoucher,
    handleHotspotClient,
    finalizePaymentById,
    finalizeVoucherCodeById
};