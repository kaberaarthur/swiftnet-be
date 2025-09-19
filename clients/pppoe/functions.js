// smsSender.js
const db = require('../../dbPromise');
const pool = require('../../dbPromise');
const axios = require('axios');
const { Client } = require('ssh2');

// Static credentials and constants
const API_KEY = 'atsk_9cfc317182ef7086d1c0c7c4445f2a95fa4578a005917a45f5b9921539ae0fd1cde536d2';
const USERNAME = 'Swiftnet_sms';
const SENDER_ID = 'SwiftKenya';

/**
 * Send an OTP SMS to a client and update it in the database
 * @param {number} clientId - ID of the client in the database
 * @param {string|string[]} phoneNumbers - Phone number(s) to send the message to
 * @param {string|null} maskedNumber - Optional masked number
 * @param {string|null} telco - Optional telco
 */
async function sendSMS(clientId, phoneNumbers, maskedNumber = null, telco = null) {
  if (typeof phoneNumbers === 'string') {
    phoneNumbers = [phoneNumbers];
  }

  // Generate random 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000);

  // Build message
  const message = `Your verification code is ${otp}. It expires in 5 minutes.`;

  // Update OTP in database
  try {
    const [updateResult] = await db.execute(
      'UPDATE pppoe_clients SET otp = ? WHERE id = ?',
      [otp, clientId]
    );

    if (updateResult.affectedRows === 0) {
      console.warn(`No client found with ID ${clientId} to update OTP.`);
    } else {
      console.log(`OTP ${otp} updated for client ID ${clientId}.`);
    }
  } catch (err) {
    console.error('Database error while updating OTP:', err);
    throw err;
  }

  const url = 'https://api.africastalking.com/version1/messaging/bulk';

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apiKey: API_KEY,
  };

  const payload = {
    username: USERNAME,
    message,
    senderId: SENDER_ID,
    phoneNumbers,
  };

  if (maskedNumber) payload.maskedNumber = maskedNumber;
  if (telco) payload.telco = telco;

  console.log('Sending OTP SMS:', message);
  console.log('Phone Numbers:', phoneNumbers);

  try {
    const response = await axios.post(url, payload, { headers });
    console.log('SMS Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    throw error;
  }
}

// Function to execute the SSH command on MikroTik
function executeSSHCommand(ip_address, username, password, secret_name, command) {
    return new Promise((resolve, reject) => {
        const ssh = new Client();

        ssh.on('ready', () => {
            const sshCommand = `/ppp secret set [find name=${secret_name}] disabled=${command === 'disable' ? 'yes' : 'no'}`;
            console.log('Executing SSH Command:', sshCommand);
            
            ssh.exec(sshCommand, (err, stream) => {
                if (err) {
                    console.error('SSH Command Execution Error:', err);
                    reject(`SSH Command Execution Error: ${err}`);
                    ssh.end();
                } else {
                    let output = '';
                    let error = '';
                    
                    stream.on('data', (data) => {
                        output += data.toString();
                    });
                    
                    stream.on('stderr', (data) => {
                        error += data.toString();
                    });
                    
                    stream.on('close', () => {
                        ssh.end();
                        if (error) {
                            console.error('SSH Command Error Output:', error);
                            reject({ status: 'error', message: error });
                        } else {
                            resolve({ status: 'success', message: `PPP Secret '${secret_name}' ${command}d successfully.` });
                        }
                    });
                }
            });
        }).on('error', (err) => {
            console.error('SSH Connection Failed:', err);
            reject(`SSH Connection Failed: ${err}`);
        }).connect({
            host: ip_address,
            username: username,
            password: password,
            port: 22,
        });
    });
}

function changePppoePlan(ip_address, username, password, secret_name, new_plan) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            // console.log('SSH Connection Established');

            // MikroTik command to update the PPPoE secret profile
            const command = `/ppp secret set [find name=${secret_name}] profile="${new_plan}"`;
            console.log("Change PPPoE Plan: ", command)

            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject({ status: 'error', message: `SSH command error: ${err.message}` });
                }

                let output = '';
                let error = '';

                stream.on('data', (data) => {
                    output += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    error += data.toString();
                });

                stream.on('close', () => {
                    conn.end();
                    if (error) {
                        reject({ status: 'error', message: error.trim() });
                    } else {
                        resolve({ status: 'success', message: `PPP secret '${secret_name}' updated to plan '${new_plan}'.` });
                    }
                });
            });
        });

        conn.on('error', (err) => {
            reject({ status: 'error', message: `SSH Connection Error: ${err.message}` });
        });

        conn.connect({
            host: ip_address,
            port: 22,
            username: username,
            password: password
        });
    });
}

function getRouterDetails(router_id) {
    return new Promise(async (resolve, reject) => {
        try {
            // Get a connection from the pool
            const connection = await pool.getConnection();
            
            // SQL query to get router details
            const query = "SELECT ip_address, username, router_secret FROM routers WHERE id = ?";
            const [rows] = await connection.execute(query, [router_id]);
            
            // Release the connection back to the pool
            connection.release();

            if (rows.length === 0) {
                reject('Router not found');
            } else {
                resolve(rows[0]);  // Return the first matching row
            }
        } catch (err) {
            reject(`Database Error: ${err}`);
        }
    });
}

module.exports = { sendSMS, executeSSHCommand, changePppoePlan, getRouterDetails };
