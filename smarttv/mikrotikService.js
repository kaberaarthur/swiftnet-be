const { Client } = require('ssh2');
const moment = require('moment-timezone');

function runCommand(sshConfig, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          let stdout = "";
          let stderr = "";

          stream
            .on("close", (code, signal) => {
              conn.end();
              if (stderr) return reject(new Error(stderr));
              resolve(stdout.trim());
            })
            .on("data", (data) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", (err) => {
        reject(err);
      })
      .connect(sshConfig);
  });
}

// Include Phone and End Date, cut using mikrotik script
async function addBinding(sshConfig, mac, type = "bypassed", phone_number, end_date) {
  const commentParts = [];

  if (phone_number) commentParts.push(`phone=${phone_number}`);

  // Convert end_date to Unix timestamp (seconds)
  if (end_date) {
    const expiryTimestamp = Math.floor(new Date(end_date).getTime() / 1000);
    commentParts.push(`expiry=${expiryTimestamp}`);
  }

  const comment = commentParts.join(';') || 'SmartTV';

  return runCommand(
    sshConfig,
    `/ip hotspot ip-binding add mac-address=${mac} type=${type} comment="${comment}"`
  );
}


async function setBindingType(sshConfig, mac, type) {
  return runCommand(
    sshConfig,
    `/ip hotspot ip-binding set [find mac-address=${mac}] type=${type}`
  );
}

// Run a direct ssh command to remove active session and binding for a MAC
async function removeActiveSession(sshConfig, mac) {
  const macNorm = mac.toUpperCase(); // MikroTik expects uppercase MAC format

  // Run both commands one after the other
  return runCommand(
    sshConfig,
    `/ip hotspot host remove [find mac-address=${macNorm}]; /ip hotspot ip-binding remove [find mac-address=${macNorm}]`
  );
}

// Disconnect all expired TVs based on current timestamp
async function disconnectTV(sshConfig) {
  // 🔹 Current Nairobi time → Unix timestamp (seconds, 10 digits)
  const timestamp = moment().tz("Africa/Nairobi").unix();
  console.log("Disconnect timestamp:", timestamp);

  try {
    // First add file to router for timestamp reference
    await runCommand(
      sshConfig,
      `/file set disconnect-timestamp.txt contents="${timestamp}"`
    );

    // 🔹 Run your script after the first succeeds
    await runCommand(sshConfig, `/system script run remove-expired-bindings`);

    console.log("✅ Timestamp set and script executed successfully");
  } catch (error) {
    console.error("❌ Failed to disconnect TV:", error);
  }
}

module.exports = {
  addBinding,
  setBindingType,
  removeActiveSession,
  disconnectTV
};