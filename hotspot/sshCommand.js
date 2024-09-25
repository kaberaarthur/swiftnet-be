const { Client } = require('ssh2');

function runSSHCommand(command) {
    const conn = new Client();
    
    return new Promise((resolve, reject) => {
        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    reject('SSH connection error: ' + err.message);
                    conn.end();
                    return;
                }

                let data = '';
                let errorData = '';

                stream.on('close', (code, signal) => {
                    conn.end();
                    if (data.toLowerCase().includes('failure')) {
                        reject('SSH command failed: ' + errorData || data);
                    } else {
                        resolve(data);
                    }
                }).on('data', (chunk) => {
                    data += chunk.toString();
                }).stderr.on('data', (chunk) => {
                    errorData += chunk.toString();
                });
            });
        }).on('error', (err) => {
            reject('SSH connection error: ' + err.message);
        }).connect({
            host: '102.0.5.26', // MikroTik router IP
            port: 22,
            username: 'Arthur',
            password: 'Arthur'
        });
    });
}

module.exports = { runSSHCommand };
