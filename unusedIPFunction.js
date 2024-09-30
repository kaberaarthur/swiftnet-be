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

// Export the function
module.exports = {
    findUnusedIPs
  };