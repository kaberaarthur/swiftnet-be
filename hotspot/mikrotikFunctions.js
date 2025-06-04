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

module.exports = { enableHotspotUser };
