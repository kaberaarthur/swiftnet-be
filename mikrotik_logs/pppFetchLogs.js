const { Client } = require('ssh2');

function fetchMikrotikLogs(host, username, password, callback) {
    const conn = new Client();
    conn.on('ready', () => {
        console.log('Client :: ready');
        conn.exec('/log print where topics~"pppoe"', (err, stream) => {
            if (err) return callback(err);

            let logs = '';
            stream.on('close', (code, signal) => {
                if (code !== 0) {
                    return callback(new Error(`Error fetching logs: ${signal}`));
                } else {
                    // Process the logs
                    const lastTwoHundredLogs = logs.trim().split('\n').slice(-200);
                    const processedItems = lastTwoHundredLogs.map(log => {
                        // Regex to match the time format hh:mm:ss at the beginning of the line
                        const timeRegex = /^\s*(\d{2}:\d{2}:\d{2})/;
                        const timeMatch = log.match(timeRegex);

                        if (timeMatch) {
                            const timestamp = timeMatch[1]; // Extracted time
                            const message = log.slice(timeMatch[0].length).trim(); // The rest is the message

                            return {
                                timestamp: timestamp,
                                message: message
                            };
                        } else {
                            // Handle cases where the timestamp is not found
                            return {
                                timestamp: '',
                                message: log // Return the whole log if the format is unexpected
                            };
                        }
                    });

                    // Convert processed items to JSON and call the callback
                    callback(null, JSON.stringify(processedItems, null, 4));
                }
                conn.end();
            }).on('data', (data) => {
                logs += data.toString();
            }).stderr.on('data', (data) => {
                console.log(`STDERR: ${data}`);
            });
        });
    }).connect({
        host: host,
        port: 22,
        username: username,
        password: password
    });
}

module.exports = fetchMikrotikLogs;
