const { Client } = require('ssh2');

function runSSHCommand(command, ip_address, username, password, port = 22) {
  // console.log("Start Creating the Plan on Mikrotik!");
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(new Error('SSH connection error: ' + err.message));
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          conn.end();

          // Log the outputs for debugging
          console.log('SSH STDOUT:', stdout.trim());
          console.log('SSH STDERR:', stderr.trim());

          // If Mikrotik returned a !trap, consider it a warning unless critical
          const failureKeywords = ['invalid', 'failure', 'not allowed', 'already exists'];

          if (stderr && failureKeywords.some(k => stderr.toLowerCase().includes(k))) {
            return reject(new Error(`Router returned error: ${stderr.trim()}`));
          }

          resolve(stdout.trim());
        }).on('data', (chunk) => {
          stdout += chunk.toString();
        }).stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
      });
    }).on('error', (err) => {
      reject(new Error('SSH connection failed: ' + err.message));
    }).connect({
      host: ip_address,
      port,
      username,
      password
    });
  });
}

module.exports = { runSSHCommand };
