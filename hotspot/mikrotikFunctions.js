const { Client } = require('ssh2');
const db = require('../dbPromise');

async function enableHotspotUser(router_id, hotspot_user) {
  if (!router_id || !hotspot_user) {
    return { success: false, message: 'router_id and hotspot_user are required.' };
  }

  try {
    // Fetch router details
    const [rows] = await db.execute(
      'SELECT ip_address, username, router_secret, port FROM routers WHERE id = ? LIMIT 1',
      [router_id]
    );

    if (rows.length === 0) {
      return { success: false, message: 'Router not found.' };
    }

    const { ip_address, username, router_secret, port } = rows[0];

    // SSH connection
    return new Promise((resolve) => {
      const conn = new Client();
      conn
        .on('ready', () => {
          conn.exec(`/ip hotspot user enable [find name=${hotspot_user}]`, (err, stream) => {
            if (err) {
              conn.end();
              return resolve({ success: false, message: `SSH command error: ${err.message}` });
            }

            let output = '';
            let error = '';

            stream
              .on('close', () => {
                conn.end();
                if (error) {
                  return resolve({ success: false, message: `Router error: ${error}` });
                }
                return resolve({
                  success: true,
                  message: `Hotspot user "${hotspot_user}" enabled successfully.`,
                  output: output.trim()
                });
              })
              .on('data', (data) => (output += data))
              .stderr.on('data', (data) => (error += data));
          });
        })
        .on('error', (err) => {
          return resolve({ success: false, message: `SSH connection error: ${err.message}` });
        })
        .connect({
          host: ip_address,
          port: port || 22,
          username: username,
          password: router_secret
        });
    });
  } catch (err) {
    console.error('Enable Hotspot Error:', err);
    return { success: false, message: 'Internal server error.' };
  }
}

async function getRouterDetails(router_id) {
  if (!router_id) {
    return { success: false, message: 'router_id is required.' };
  }

  try {
    const [rows] = await db.execute(
      'SELECT ip_address, router_secret, username, port, company_id, router_name, company_username FROM routers WHERE id = ? LIMIT 1',
      [router_id]
    );

    if (rows.length === 0) {
      return { success: false, message: 'Router not found.' };
    }

    return {
      success: true,
      message: 'Router details retrieved successfully.',
      data: rows[0]
    };
  } catch (error) {
    console.error('Error fetching router details:', error.message);
    return {
      success: false,
      message: 'Database error.',
      error: error.message
    };
  }
}

async function createMikrotikHotspotUser(ip, username, password, phone_number, userPassword, plan_name, port = 22) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      const command = `/ip hotspot user add name="${phone_number}" password="${userPassword}" profile="${plan_name}"`;

      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject({ success: false, message: 'SSH command failed', error: err.message });
        }

        let errorOutput = '';

        stream
          .on('close', (code, signal) => {
            conn.end();

            if (errorOutput) {
              return reject({
                success: false,
                message: 'Router responded with an error',
                error: errorOutput,
              });
            }

            resolve({ success: true, message: 'Hotspot user added successfully' });
          })
          .on('data', (data) => {
            console.log('STDOUT:', data.toString());
          });

        stream.stderr.on('data', (data) => {
          errorOutput += data.toString();
          console.error('STDERR:', data.toString());
        });
      });
    });

    conn.on('error', (err) => {
      reject({ success: false, message: 'SSH connection error', error: err.message });
    });

    conn.connect({
      host: ip,
      port: port || 22,
      username: username,
      password: password,
    });
  });
}

async function createOrResetMikrotikHotspotUser(ip, username, password, phone_number, userPassword, plan_name, port = 22) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      const checkCommand = `/ip hotspot user print where name="${phone_number}"`;

      conn.exec(checkCommand, (err, stream) => {
        if (err) {
          conn.end();
          return reject({ success: false, message: 'SSH command failed', error: err.message });
        }

        let output = '';
        let errorOutput = '';

        stream
          .on('close', () => {
            if (errorOutput) {
              conn.end();
              return reject({
                success: false,
                message: 'Error checking user existence',
                error: errorOutput,
              });
            }

            if (output.includes(phone_number)) {
              // User exists — reset password
              const resetCommand = `/ip hotspot user set [find where name="${phone_number}"] password="${userPassword}" profile="${plan_name}" disabled=no`;

              conn.exec(resetCommand, (err, resetStream) => {
                if (err) {
                  conn.end();
                  return reject({ success: false, message: 'Failed to reset password', error: err.message });
                }

                let resetError = '';
                resetStream
                  .on('close', () => {
                    conn.end();
                    if (resetError) {
                      return reject({
                        success: false,
                        message: 'Error resetting password',
                        error: resetError,
                      });
                    }

                    console.log(`✅ Password for user "${phone_number}" was reset successfully on MikroTik router ${ip}.`);

                    return resolve({
                      success: true,
                      message: 'User already existed — password reset successfully',
                      data: {
                        username: phone_number,
                        password: userPassword,
                      },
                    });
                  })
                  .on('data', () => {}); // Ignore output

                resetStream.stderr.on('data', (data) => {
                  resetError += data.toString();
                });
              });

              return;
            }

            // User doesn't exist — create
            const createCommand = `/ip hotspot user add name="${phone_number}" password="${userPassword}" profile=${plan_name}`;
            conn.exec(createCommand, (err, createStream) => {
              if (err) {
                conn.end();
                return reject({ success: false, message: 'Failed to create user', error: err.message });
              }

              let createError = '';
              createStream
                .on('close', () => {
                  conn.end();
                  if (createError) {
                    return reject({
                      success: false,
                      message: 'Error creating user',
                      error: createError,
                    });
                  }

                  console.log(`✅ New hotspot user "${phone_number}" created successfully on MikroTik router ${ip}.`);

                  resolve({
                    success: true,
                    message: 'User created successfully',
                    data: {
                      username: phone_number,
                      password: userPassword,
                    },
                  });
                })
                .on('data', () => {}); // Ignore output

              createStream.stderr.on('data', (data) => {
                createError += data.toString();
              });
            });
          })
          .on('data', (data) => {
            output += data.toString();
          });

        stream.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      reject({ success: false, message: 'SSH connection error', error: err.message });
    });

    conn.connect({
      host: ip,
      port: port || 22,
      username,
      password,
    });
  });
}

module.exports = { enableHotspotUser, getRouterDetails, createMikrotikHotspotUser, createOrResetMikrotikHotspotUser };
