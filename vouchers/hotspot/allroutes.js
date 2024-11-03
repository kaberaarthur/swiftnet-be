const express = require('express');
const router = express.Router();
const db = require('../../dbPromise'); // Change to use `db` instead of `dbPromise`
const { Client } = require('ssh2');

// Function to generate a voucher code
const generateVoucherCode = async (connection, index, lastId) => {
    // Get the current month and day of the week
    const now = new Date();
    const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    const monthLetter = months[now.getMonth()]; // e.g. "S" for September
    const dayLetter = days[now.getDay()]; // e.g. "M" for Monday

    // Generate a random uppercase letter
    const randomLetter = String.fromCharCode(65 + Math.floor(Math.random() * 26)); // "A" to "Z"

    // Create the code using the last ID plus the current index
    const numberPart = String(lastId + index).padStart(4, '0'); // Ensures it has 4 digits, e.g., "0001"

    // Combine everything
    return `${monthLetter}${dayLetter}${randomLetter}${numberPart}`; // e.g., "SMV0001"
};

function generatePassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const specialChars = '!@#$%^&*';
    
    // Ensure one character from each set
    const passwordArray = [
      uppercase[Math.floor(Math.random() * uppercase.length)],
      lowercase[Math.floor(Math.random() * lowercase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      specialChars[Math.floor(Math.random() * specialChars.length)],
    ];
    
    // Fill the remaining 2 characters randomly from all sets
    const allChars = uppercase + lowercase + numbers + specialChars;
    for (let i = 0; i < 2; i++) {
      passwordArray.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }
    
    // Shuffle the array to randomize character order
    const shuffledPassword = passwordArray.sort(() => 0.5 - Math.random()).join('');
    
    return shuffledPassword;
};


// Separate function for redeeming a voucher
async function redeemVoucher(router_id, voucherCode, macAddress) {
    let connection;
    try {
        connection = await db.getConnection();

        // Check if the voucher exists with the provided voucher_code
        const [voucher] = await connection.query(
            `SELECT * FROM hotspot_vouchers WHERE voucher_code = ?`,
            [voucherCode]
        );

        if (voucher.length === 0) {
            connection.release();
            return { success: false, message: 'Voucher not found' };
        }

        // Check if the router_id matches
        const voucherData = voucher[0];
        if (voucherData.router_id !== router_id) {
            connection.release();
            return { success: false, message: 'You are on the wrong router' };
        }

        // Check if `current_users` is below `total_users`
        if (voucherData.current_users >= voucherData.total_users) {
            connection.release();
            return { success: false, message: 'Voucher user limit reached' };
        }

        // Calculate voucher expiration time based on `voucher_start` and `plan_validity`
        const now = new Date();
        if (voucherData.voucher_start) {
            const voucherExpiration = new Date(voucherData.voucher_start);
            voucherExpiration.setHours(voucherExpiration.getHours() + voucherData.plan_validity);

            if (now < new Date(voucherData.voucher_start) || now > voucherExpiration) {
                connection.release();
                return { success: false, message: 'Voucher redemption period has ended' };
            }
        } else {
            // Set `voucher_start` if this is the first redemption
            await connection.query(
                `UPDATE hotspot_vouchers SET voucher_start = NOW() WHERE voucher_code = ?`,
                [voucherCode]
            );
        }

        // Update the voucher information in the database
        const newMacAddress = voucherData.mac_address 
            ? `${voucherData.mac_address},${macAddress}` 
            : macAddress;
        const newVoucherRedeemedAt = voucherData.voucher_redeemed_at 
            ? `${voucherData.voucher_redeemed_at},${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
            : new Date().toISOString().slice(0, 19).replace('T', ' ');

        await connection.query(
            `UPDATE hotspot_vouchers SET 
                current_users = current_users + 1,
                status = CASE WHEN current_users + 1 >= total_users THEN 'used' ELSE status END,
                mac_address = ?, 
                voucher_redeemed_at = ? 
            WHERE voucher_code = ?`,
            [newMacAddress, newVoucherRedeemedAt, voucherCode]
        );

        // Fetch the updated row
        const [updatedRow] = await connection.query(
            `SELECT * FROM hotspot_vouchers WHERE voucher_code = ?`,
            [voucherCode]
        );

        console.log('Updated Row:', updatedRow[0].voucher_start);
        const targetRow = updatedRow[0];


        // Run the createUser function and capture the generated password
        const password = generatePassword();
        const createUserResponse = await createUser(macAddress, router_id, voucherData.plan_id, password, targetRow);

        connection.release();
        return { 
            success: createUserResponse === "success", 
            message: createUserResponse === "success" ? 'Voucher redeemed successfully' : 'Failed to redeem voucher',
            password: password, 
            createUserResponse 
        };
    } catch (error) {
        console.error('Error redeeming voucher:', error);
        if (connection) connection.release();
        return { success: false, message: 'Server error' };
    }
};

// Add a function to create a user in Mikrotik and generate a password
// Function to fetch router and create user if not already created
async function createUser(macAddress, routerId, planId, password, targetRow) {
    console.log("Voucher Start Time: ", targetRow.voucher_start)

    let connection;
    try {
        // Connect to the database
        connection = await db.getConnection();
        
        // Fetch router details by router_id
        const [routers] = await connection.query(
            `SELECT * FROM routers WHERE id = ?`,
            [routerId]
        );

        if (routers.length === 0) {
            console.log('Router not found');
            return "router_not_found";
        }

        const router = routers[0];
        console.log('Router Details:', router);

        // Check if user already exists on the MikroTik router
        const conn = new Client();
        return await new Promise((resolve, reject) => {
            conn.on('ready', () => {
                console.log('SSH Connection established.');

                // Check if user exists based on macAddress
                conn.exec(`/ip hotspot user print where name="${macAddress}"`, (err, stream) => {
                    if (err) return reject("command_failed");

                    let userExists = false;
                    stream.on('data', (data) => {
                        const output = data.toString();
                        userExists = output.includes(macAddress);
                    }).on('close', () => {
                        if (!userExists) {
                            // If user doesn't exist, create it
                            conn.exec(`/ip hotspot user add name="${macAddress}" password="${password}"`, (err) => {
                                conn.end();
                                if (err) return reject("command_failed");
                                console.log(`User created for MAC Address: ${macAddress}`);
                                resolve("success");
                            });
                        } else {
                            // User exists, update the password
                            conn.exec(`/ip hotspot user set [find name="${macAddress}"] password="${password}"`, (err) => {
                                conn.end();
                                if (err) return reject("command_failed");
                                console.log(`Password updated for user with MAC Address: ${macAddress}`);
                                resolve("success");
                            });
                        }
                    });
                });
            }).on('error', (err) => {
                console.error('SSH Connection error:', err);
                reject("connection_failed");
            }).connect({
                host: router.ip_address,
                port: 22,
                username: router.username,
                password: router.router_secret
            });
        });

    } catch (error) {
        console.error('Database or other error:', error);
        return "database_error";
    } finally {
        if (connection) connection.release();
    }
};

// Check Hotspot User with MacAddress
async function checkMacAddressExists(mac_address) {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
      const [rows] = await connection.execute(
        'SELECT 1 FROM hotspot_clients WHERE mac_address = ? LIMIT 1',
        [mac_address]
      );
      return rows.length > 0;
    } catch (error) {
      console.error('Error checking MAC address:', error);
      return false;
    } finally {
      await connection.end();
    }
};

// Helper function to handle database actions
async function updateOrCreateUser(connection, userExists, macAddress, password, targetRow) {
    const serviceStart = targetRow.voucher_start;
    const serviceExpiry = new Date(new Date(serviceStart).getTime() + targetRow.plan_validity); // Adding plan validity in hours

    const macExists = await checkMacAddressExists(macAddress);

    if (macExists) {
        // Update existing user in `hotspot_clients` table
        await connection.query(
            `UPDATE hotspot_clients SET 
                service_start = ?, 
                service_expiry = ?, 
                password = ? 
             WHERE mac_address = ?`,
            [serviceStart, serviceExpiry, password, macAddress]
        );
        console.log(`Updated existing user with MAC Address: ${macAddress}`);
        return { success: true, message: "User updated successfully" };
    } else {
        // Insert new user in `hotspot_clients` table
        await connection.query(
            `INSERT INTO hotspot_clients (
                mac_address, plan_id, plan_name, plan_validity, 
                service_start, service_expiry, router_name, router_id, 
                company_username, company_id, password
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                macAddress,
                targetRow.plan_id,
                targetRow.plan_name,
                targetRow.plan_validity,
                serviceStart,
                serviceExpiry,
                targetRow.router_name,
                targetRow.router_id,
                targetRow.company_username,
                targetRow.company_id,
                password
            ]
        );
        console.log(`Created new user with MAC Address: ${macAddress}`);
        return { success: true, message: "User created successfully" };
    }
};


// Create multiple vouchers
router.post('/hotspot-vouchers', async (req, res) => {
    const { company_id, company_username, plan_id, plan_name, plan_validity, router_id, router_name, voucherCodes } = req.body;

    let connection;
    try {
        connection = await db.getConnection(); // Get the database connection

        // Query to get the shared_users from the `hotspot_plans` table based on the provided plan_id
        const [planRows] = await connection.query('SELECT shared_users FROM hotspot_plans WHERE id = ?', [plan_id]);
        
        if (planRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Plan not found' });
        }

        const sharedUsers = planRows[0].shared_users;

        // Query to get the last used voucher ID from the `hotspot_vouchers` table
        const [rows] = await connection.query('SELECT MAX(id) AS lastId FROM hotspot_vouchers');
        const lastId = rows[0].lastId || 0; // Start from 0 if there are no vouchers

        // Generate vouchers dynamically based on the number of voucher codes
        const vouchers = await Promise.all(voucherCodes.map(async (voucherCode, index) => {
            // Generate a unique voucher code, incrementing from lastId
            const generatedCode = await generateVoucherCode(connection, index + 1, lastId);
            return (`(${router_id}, '${router_name}', '${plan_name}', ${plan_id}, '${generatedCode}', '${company_username}', ${company_id}, ${plan_validity}, ${sharedUsers}, NOW())`);
        }));

        const query = `
            INSERT INTO hotspot_vouchers (router_id, router_name, plan_name, plan_id, voucher_code, company_username, company_id, plan_validity, total_users, date_created)
            VALUES ${vouchers.join(', ')}
        `;

        await connection.execute(query);
        connection.release(); // Release the connection back to the pool

        res.status(201).json({ success: true, message: 'Vouchers created successfully' });
    } catch (error) {
        console.error('Error inserting vouchers:', error);
        if (connection) connection.release(); // Ensure connection is released even on error
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// Read vouchers with filters
router.get('/hotspot-vouchers', async (req, res) => {
    const { router_id, company_id } = req.query;

    try {
        let query = 'SELECT * FROM hotspot_vouchers WHERE 1=1'; // Basic query to start with

        if (router_id) {
            query += ` AND router_id = ${router_id}`;
        }
        if (company_id) {
            query += ` AND company_id = ${company_id}`;
        }

        const [rows] = await db.execute(query);
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching vouchers:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update a voucher
router.patch('/hotspot-vouchers/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
        const updateStatements = Object.entries(updates).map(([key, value]) => {
            return `${key} = ${typeof value === 'string' ? `'${value}'` : value}`;
        }).join(', ');

        const query = `
            UPDATE hotspot_vouchers
            SET ${updateStatements}
            WHERE id = ${id}
        `;

        await db.execute(query);
        res.status(200).json({ success: true, message: 'Voucher updated successfully' });
    } catch (error) {
        console.error('Error updating voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete a voucher
router.delete('/hotspot-vouchers/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            DELETE FROM hotspot_vouchers
            WHERE id = ${id}
        `;

        await db.execute(query);
        res.status(200).json({ success: true, message: 'Voucher deleted successfully' });
    } catch (error) {
        console.error('Error deleting voucher:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete all vouchers with status 'used'
router.delete('/hotspot-vouchers-delete-all', async (req, res) => {
    try {
        const query = `
            DELETE FROM hotspot_vouchers
            WHERE status = 'used'
        `;

        const [result] = await db.execute(query);
        res.status(200).json({ success: true, message: 'All used vouchers deleted successfully', affectedRows: result.affectedRows });
    } catch (error) {
        console.error('Error deleting used vouchers:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// Route: Redeem Voucher directly
router.post('/hotspot-vouchers-redeem', async (req, res) => {
    const { router_id, voucherCode, macAddress } = req.body;
    const result = await redeemVoucher(router_id, voucherCode, macAddress);
    res.status(200).json(result);
});



// Check if a voucher exists
router.post('/check-voucher', async (req, res) => {
    const { mpesa_code } = req.body; // Expecting mpesa_code in the body

    if (!mpesa_code) {
        return res.status(400).json({ success: false, message: 'mpesa_code is required' });
    }

    let connection;
    try {
        connection = await db.getConnection(); // Get the database connection

        // Query to check if the mpesa_code exists in the hotspot_vouchers table
        const [rows] = await connection.query(
            'SELECT * FROM hotspot_vouchers WHERE mpesa_code = ?',
            [mpesa_code]
        );

        connection.release(); // Release the connection back to the pool

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher not found' });
        }

        // If found, return the voucher row
        res.status(200).json({ success: true, data: rows[0] }); // Return the first found row
    } catch (error) {
        console.error('Error checking voucher:', error);
        if (connection) connection.release(); // Ensure connection is released even on error
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// This is for the Mikrotik User
// They will send the mpesa code plus the other similar data
// The code will retireve the voucher code and run it through the aboveendpoint the login the user
router.post('/check-voucher-redeem', async (req, res) => {
    const { mpesa_code, router_id, macAddress } = req.body; // Expecting mpesa_code, router_id, and macAddress in the body

    // Check for the required fields
    if (!mpesa_code || !router_id || !macAddress) {
        return res.status(400).json({ 
            success: false, 
            message: 'mpesa_code, router_id, and macAddress are required' 
        });
    }

    let connection;
    try {
        connection = await db.getConnection(); // Get the database connection

        // Query to check if the mpesa_code exists in the hotspot_vouchers table
        const [rows] = await connection.query(
            'SELECT * FROM hotspot_vouchers WHERE mpesa_code = ?',
            [mpesa_code]
        );

        connection.release(); // Release the connection back to the pool

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher not found' });
        }

        console.log('Voucher Code:', rows[0].voucher_code);
        console.log('Router ID:', router_id);
        console.log('MAC Address:', macAddress);

        // Call redeemVoucher with the retrieved data
        const result = await redeemVoucher(router_id, rows[0].voucher_code, macAddress);

        // Respond with the result of redeeming the voucher
        res.status(200).json(result);
    } catch (error) {
        console.error('Error checking voucher:', error);
        if (connection) connection.release(); // Ensure connection is released even on error
        res.status(500).json({ success: false, message: 'Server error' });
    }
});



module.exports = router;
