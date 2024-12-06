const { Client } = require('ssh2');


// Function to create a PPPoE user
async function createPPPoEUser(routerIp, routerUsername, routerPassword, phoneNumber, password, planName) {
    const command = `/ppp secret add name="${phoneNumber}" password="${password}" profile="${planName}"`;

    return new Promise((resolve, reject) => {
        const ssh = new Client();

        ssh.on('ready', () => {
            ssh.exec(command, (err, stream) => {
                if (err) {
                    ssh.end();
                    return resolve({
                        success: false,
                        error: `SSH command execution failed: ${err.message}`,
                    });
                }

                let output = ''; // Combined output from stdout and stderr

                // Collect data from both stdout and stderr
                stream.on('data', (data) => {
                    output += data.toString();
                });

                // When the stream closes, process the results
                stream.on('close', () => {
                    ssh.end();

                    // Check if there's any output and print it
                    if (output.trim()) {
                        return resolve({
                            success: true,
                            data: output.trim(), // Output will be returned here
                        });
                    }

                    return resolve({
                        success: false,
                        error: 'No output received from the command.',
                    });
                });
            });
        });

        // Handle any connection errors
        ssh.on('error', (err) => {
            resolve({
                success: false,
                error: `SSH connection error: ${err.message}`,
            });
        });

        // SSH connection details
        ssh.connect({
            host: routerIp,
            port: 22,
            username: routerUsername,
            password: routerPassword,
        });
    });
}

// Example usage of createPPPoEUser function
const routerIp = '102.0.14.218';
const routerUsername = 'Arthur';
const routerPassword = 'Arthur';
const phoneNumber = '0720338721';  // Example phone number
const password = 'securePassword';
const planName = '108 Mbps profile';

createPPPoEUser(routerIp, routerUsername, routerPassword, phoneNumber, password, planName)
    .then(response => {
        if (response.success) {
            console.log('Command output:', response.data);  // Print the combined output
        } else {
            console.error(response.error);  // Print the error
        }
    })
    .catch(error => {
        console.error('Error creating PPPoE user:', error);
    });
