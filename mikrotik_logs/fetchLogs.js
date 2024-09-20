const { Client } = require('ssh2');

function fetchMikrotikLogs(host, username, password, callback) {
    const conn = new Client();
    conn.on('ready', () => {
        console.log('Client :: ready');
        conn.exec('/log print where topics~"hotspot"', (err, stream) => {
            if (err) return callback(err);

            let logs = '';
            stream.on('close', (code, signal) => {
                if (code !== 0) {
                    return callback(new Error(`Error fetching logs: ${signal}`));
                } else {
                    // Process the logs
                    // Inside fetchMikrotikLogs function
                    // Getting last 200 items
                    const lastFiftyLogs = logs.trim().split('\n').slice(-200);
                    const processedItems = lastFiftyLogs.map(log => {
                        // Regex to match the MAC address pattern and capture everything until the end of the line
                        const macRegex = /([0-9A-Fa-f]{2}(:|-)){5}([0-9A-Fa-f]{2})/; // Adjust this if necessary based on your MAC address format
                        const macMatch = log.match(macRegex);

                        if (macMatch) {
                            const macAddress = macMatch[0];
                            const parts = log.split(macAddress);
                            const preMac = parts[0].trim(); // Everything before the MAC address
                            const message = parts[1] ? parts[1].trim() : ''; // Everything after the MAC address

                            // Extract the timestamp and topics from preMac
                            const preMacParts = preMac.split(' ');
                            const timestamp = preMacParts.shift(); // First part is the timestamp
                            const topics = preMacParts.join(' '); // Join the rest as topics

                            return {
                                timestamp: timestamp,
                                topics: topics,
                                mac_address: macAddress,
                                message: message
                            };
                        } else {
                            // Handle cases where MAC address is not found
                            return {
                                timestamp: '',
                                topics: '',
                                mac_address: '',
                                message: log // Return the whole log as a message
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
