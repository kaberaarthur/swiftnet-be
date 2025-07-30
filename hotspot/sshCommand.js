const { Client } = require('ssh2');

function runSSHCommand(command, ip_address, username, password, port = 22) {
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

          // console.log('SSH STDOUT:', stdout.trim());
          // console.log('SSH STDERR:', stderr.trim());

          const failureKeywords = ['invalid', 'failure', 'not allowed', 'already exists', 'error', '!trap'];

          const failed =
            failureKeywords.some(k => stdout.toLowerCase().includes(k)) ||
            failureKeywords.some(k => stderr.toLowerCase().includes(k));

          if (failed) {
            return reject(new Error(`Router error:\nSTDOUT: ${stdout.trim()}\nSTDERR: ${stderr.trim()}`));
          }

          resolve(stdout.trim());
        }).on('data', chunk => {
          stdout += chunk.toString();
        }).stderr.on('data', chunk => {
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
