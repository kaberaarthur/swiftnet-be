const express = require('express');
const { Client } = require('ssh2');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../../../dbPromise');
const fs = require("fs");
const SFTPClient = require("ssh2-sftp-client");
const path = require("path");

async function getRouterByID(router_id) {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM routers WHERE id = ? LIMIT 1',
      [router_id]
    );

    if (rows.length > 0) {
      // console.log("Router found:", rows[0]);
      return { success: true, data: rows[0] };
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
    
    jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
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
  const dataRows = [];
  let current = null;
  let comment = "";
  let recordContent = "";
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    
    // Capture comment line
    if (line.startsWith(';;;')) {
      comment = line.replace(';;;', '').trim();
      continue;
    }
    
    // Detect start of new record
    const indexMatch = line.match(/^(\d+)\s+(X)?/);
    if (indexMatch) {
      // Process previous record if exists
      if (current && recordContent) {
        parseFields(recordContent, current);
      }
      if (current) dataRows.push(current);
      
      // Start new record
      current = {
        index: parseInt(indexMatch[1]),
        disabled: indexMatch[2] === 'X',
        comment: comment || "",
        name: "",
        service: "",
        password: "",
        profile: ""
      };
      comment = "";
      
      // Get content after index and disabled flag
      recordContent = line.substring(indexMatch[0].length).trim();
      continue;
    }
    
    // Continuation lines - append to record content
    if (current) {
      recordContent += " " + line;
    }
  }
  
  // Process the last record
  if (current && recordContent) {
    parseFields(recordContent, current);
  }
  if (current) dataRows.push(current);
  
  return dataRows;
}

function parseFields(content, record) {
  const fields = ['name', 'service', 'caller-id', 'password', 'profile'];
  
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const fieldPattern = new RegExp(`\\b${field}=`, 'i');
    const fieldMatch = content.match(fieldPattern);
    
    if (!fieldMatch) continue;
    
    const fieldStart = fieldMatch.index + fieldMatch[0].length;
    let value = "";
    
    // Check if value is quoted
    if (content[fieldStart] === '"') {
      // Quoted value - find closing quote
      const quotedStart = fieldStart + 1;
      const closingQuoteIndex = content.indexOf('"', quotedStart);
      if (closingQuoteIndex !== -1) {
        value = content.substring(quotedStart, closingQuoteIndex);
      }
    } else {
      // Unquoted value - find end based on next field or specific markers
      let valueEnd = content.length;
      
      if (field === 'profile') {
        // For profile, end at 'routes' or any field after profile
        const routesMatch = content.match(/\s+routes=/);
        if (routesMatch) {
          valueEnd = routesMatch.index;
        }
      } else {
        // For other fields, find the next field in our list
        for (let j = i + 1; j < fields.length; j++) {
          const nextField = fields[j];
          const nextFieldPattern = new RegExp(`\\s+${nextField}=`);
          const nextFieldMatch = content.substring(fieldStart).match(nextFieldPattern);
          if (nextFieldMatch) {
            valueEnd = fieldStart + nextFieldMatch.index;
            break;
          }
        }
        
        // Also check for 'routes' as it can appear after any field
        const routesMatch = content.substring(fieldStart).match(/\s+routes=/);
        if (routesMatch) {
          const routesIndex = fieldStart + routesMatch.index;
          if (routesIndex < valueEnd) {
            valueEnd = routesIndex;
          }
        }
      }
      
      value = content.substring(fieldStart, valueEnd).trim();
    }
    
    // Store only the fields we need (excluding caller-id)
    if (field !== 'caller-id' && value !== undefined) {
      record[field] = value;
    }
  }
}

// Function to fetch PPP secrets
function fetchPPPoEUsers(routerDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    const routerConfig = {
      host: routerDetails.ip_address,
      port: routerDetails.port ?? 22,
      username: routerDetails.username,
      password: routerDetails.router_secret,
    };

    conn
      .on('ready', () => {
        conn.exec('/ppp secret print detail', (err, stream) => {
          if (err) return reject(err);
          stream
            .on('close', () => {
              conn.end();

              const users = parseTextToJson(output);
              // console.log("Raw Output:", output); // Debugging line
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

    const routerDetails = await getRouterByID(router_id);

    if (!routerDetails) {
      return res.status(404).json({ error: 'Router not found or access denied' });
    }

    // console.log(routerDetails); // optional for debugging

    const users = await fetchPPPoEUsers(routerDetails.data);
    res.json(users);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// V2 Import PPP secrets from SFTP
const REMOTE_FILE = "pppoe_secrets.rsc";

// Generate PPPoE export file on MikroTik
async function generateExportFile(routerIP, username, password, port) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        conn.exec(`/ppp secret export file=${REMOTE_FILE.split(".")[0]}`, (err) => {
          if (err) return reject(err);
          conn.end();
          resolve();
        });
      })
      .connect({
        host: routerIP,
        port: port || 22,
        username,
        password,
      });
  });
}

// Download the exported file via SFTP
async function downloadExportFile(routerIP, username, password, port) {
  const localFile = path.join(__dirname, REMOTE_FILE);
  const sftp = new SFTPClient();

  await sftp.connect({
    host: routerIP,
    port: port || 22,
    username,
    password,
  });

  await sftp.get(REMOTE_FILE, localFile);
  await sftp.end();

  return localFile;
}

// Parse .rsc into JSON
function parseRscToJson(localFile) {
  const data = fs.readFileSync(localFile, "utf-8");
  const lines = data.split("\n");
  const secrets = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith("add ")) {
      const entry = {};
      const parts = [...line.matchAll(/(\S+)=("[^"]*"|\S+)/g)];
      for (const match of parts) {
        const key = match[1];
        const value = match[2].replace(/"/g, "");
        entry[key] = value;
      }
      if (!entry["disabled"]) entry["disabled"] = "no";

      // Assign id based on index
      entry["id"] = secrets.length + 1;

      secrets.push(entry);
    }
  }

  return secrets;
}


// GET endpoint
router.get("/router-pppoe-secrets", async (req, res) => {
  const id = req.query.id;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'Missing or invalid "id" query parameter.' });
  }

  try {
    const response = await getRouterByID(Number(id)); // <-- assumes you have this function

    if (!response.success) {
      return res.status(404).json({ message: "Router not found." });
    }

    const routerIP = response.data.ip_address;
    const username = response.data.username;
    const password = response.data.router_secret;
    const port = response.data.port ? response.data.port : 22;

    await generateExportFile(routerIP, username, password, port);

    // Wait for MikroTik to finish writing the export file
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const localFile = await downloadExportFile(routerIP, username, password, port);
    const secrets = parseRscToJson(localFile);

    // Clean up local file
    fs.unlinkSync(localFile);

    res.json(secrets);
  } catch (error) {
    console.error("❌ Error fetching PPPoE secrets:", error);
    res.status(500).json({ error: "Failed to fetch PPPoE secrets", message: error.message });
  }
});

module.exports = router;