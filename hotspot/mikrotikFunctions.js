const { Client } = require('ssh2');
const db = require('../dbPromise');

async function enableHotspotUser(router_id, hotspot_user) {
  if (!router_id || !hotspot_user) {
    return { success: false, message: 'router_id and hotspot_user are required.' };
  }

  try {
    // Fetch router details
    const [rows] = await db.execute(
      'SELECT ip_address, username, router_secret FROM routers WHERE id = ? LIMIT 1',
      [router_id]
    );

    if (rows.length === 0) {
      return { success: false, message: 'Router not found.' };
    }

    const { ip_address, username, router_secret } = rows[0];

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
          port: 22,
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
      'SELECT ip_address, router_secret, username FROM routers WHERE id = ? LIMIT 1',
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

async function createMikrotikHotspotUser(ip, username, password, phone_number, userPassword) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      const command = `/ip hotspot user add name="${phone_number}" password="${userPassword}" profile=default`;

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
      port: 22,
      username: username,
      password: password,
    });
  });
}

module.exports = { enableHotspotUser, getRouterDetails, createMikrotikHotspotUser };
