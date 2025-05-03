const express = require('express');
const { Client } = require('ssh2');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../../../dbPromise');

async function getRouterByID(router_id, company_id) {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM routers WHERE id = ? AND company_id = ? LIMIT 1',
      [router_id, company_id]
    );

    if (rows.length > 0) {
      return rows[0];
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching router:', error);
    throw error;
  }
}

// Middleware to verify token
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ message: 'No token provided' });
    }

    const bearerToken = token.split(' ')[1];
    
    jwt.verify(bearerToken, 'your_jwt_secret', (err, decoded) => {
        if (err) {
            return res.status(500).json({ message: 'Failed to authenticate token' });
        }
        req.userId = decoded.id;
        req.userType = decoded.user_type;
        req.company_id = decoded.company_id;
        next();
    });
}

function parseTextToJson(text) {
  const lines = text.trim().split('\n');
  
  // Extract flags information (we'll use this to determine disabled status)
  let flags = "";
  let columns = [];
  
  // Find flags and columns info
  for (const line of lines) {
    if (line.includes('Flags:')) {
      flags = line.replace('Flags:', '').trim();
    } else if (line.includes('Columns:')) {
      columns = line.replace('Columns:', '').split(',').map(col => col.trim());
    }
  }
  
  // Parse data rows
  const dataRows = [];
  
  // Process data lines (skip header lines)
  let dataStarted = false;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) continue;
    
    // Check if this is the header line that comes right before data
    if (trimmedLine.startsWith('#')) {
      dataStarted = true;
      continue;
    }
    
    // Skip lines until we find the header line
    if (!dataStarted && !trimmedLine.match(/^\d+/)) continue;
    
    // Extract data using regex to handle the fixed-width format
    const regex = /^\s*(\d+)\s+(X)?\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/;
    const match = line.match(regex);
    
    if (match) {
      const [, index, flagged, name, service, password, profile] = match;
      
      dataRows.push({
        index: parseInt(index),
        disabled: flagged === 'X',
        name: name,
        service: service,
        password: password,
        profile: profile.trim()
      });
    }
  }
  
  return dataRows;
}

// Function to fetch PPP secrets
function fetchPPPoEUsers(routerDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    const routerConfig = {
      host: routerDetails.ip_address,
      port: 22,
      username: routerDetails.username,
      password: routerDetails.router_secret,
    };

    conn
      .on('ready', () => {
        conn.exec('/ppp secret print', (err, stream) => {
          if (err) return reject(err);
          stream
            .on('close', () => {
              conn.end();

              const users = parseTextToJson(output);
              resolve(users);
            })
            .on('data', (data) => {
              output += data.toString();
            })
            .stderr.on('data', (data) => {
              console.error('STDERR:', data.toString());
            });
        });
      })
      .on('error', (err) => reject(err))
      .connect(routerConfig);
  });
}


// Define router route
router.get('/pppoe-users/:router_id', verifyToken, async (req, res) => {
  try {
    const router_id = parseInt(req.params.router_id);
    const company_id = req.company_id;

    if (isNaN(router_id)) {
      return res.status(400).json({ error: 'Invalid router ID' });
    }

    const routerDetails = await getRouterByID(router_id, company_id);

    if (!routerDetails) {
      return res.status(404).json({ error: 'Router not found or access denied' });
    }

    // console.log(routerDetails); // optional for debugging

    const users = await fetchPPPoEUsers(routerDetails);
    res.json(users);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});


module.exports = router;