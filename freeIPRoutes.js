const express = require('express');
const axios = require('axios');
const ip = require('ip');

const router = express.Router();

// MikroTik router credentials
const router_ip = '102.0.5.26';
const username = 'Arthur';
const password = 'Arthur';

// Function to get active PPPoE addresses from the MikroTik API
async function getActiveAddresses() {
  try {
    const response = await axios.get(`http://${router_ip}/rest/ppp/active`, {
      auth: {
        username: username,
        password: password
      }
    });
    // Return only the list of active addresses
    return response.data.map((entry) => entry.address);
  } catch (error) {
    console.error('Error fetching active addresses:', error.message);
    throw error;
  }
}

// Function to generate all IP addresses in the given range
function generateIPRange(start, end) {
  const startIP = ip.toLong(start);
  const endIP = ip.toLong(end);

  let allIPs = [];
  for (let i = startIP; i <= endIP; i++) {
    allIPs.push(ip.fromLong(i));
  }
  return allIPs;
}

// Function to find unused IP addresses by comparing active addresses with the generated range
async function findUnusedIPs(poolRange) {
  const [start_ip, end_ip] = poolRange.split('-'); // Split the range

  try {
    const activeIPs = await getActiveAddresses();
    const allIPs = generateIPRange(start_ip, end_ip);

    // Filter out active IPs to get unused ones
    const unusedIPs = allIPs.filter(ipAddr => !activeIPs.includes(ipAddr));

    return unusedIPs;
  } catch (error) {
    console.error('Error finding unused IPs:', error.message);
    throw error;
  }
}

// Endpoint to handle GET requests with an IP pool parameter
router.get('/get-random-ip', async (req, res) => {
  const poolRange = req.query.poolRange; // IP pool passed as a query parameter

  if (!poolRange || !poolRange.includes('-')) {
    return res.status(400).send('Invalid IP pool format. Use start_ip-end_ip.');
  }

  try {
    const unusedIPs = await findUnusedIPs(poolRange);

    if (unusedIPs.length === 0) {
      return res.status(200).send('No IP addresses left in the pool.');
    }

    // Return a random unused IP address
    const randomIP = unusedIPs[Math.floor(Math.random() * unusedIPs.length)];
    res.status(200).send({ randomIP });
  } catch (error) {
    res.status(500).send('Error fetching IP addresses.');
  }
});

module.exports = router;