// router.js or inside your main Express routes file
const express = require('express');
const { Client } = require('ssh2');
const db = require('../dbPromise');
const router = express.Router();
const getRouterById = require('./getRouterById');
const SFTPClient = require("ssh2-sftp-client");
const fs = require("fs");
const path = require("path");
const { verifyToken } = require('../systemFunctions');

// V3 Code Starts Here
const REMOTE_FILE = "pppoe_profiles.rsc";

// Generate PPPoE profile export file on MikroTik
async function generateExportFile(routerIP, username, password, port) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => {
        // ⚡ Export PPP profiles, not secrets
        conn.exec(`/ppp profile export file=${REMOTE_FILE.split(".")[0]}`, (err) => {
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
// Parse .rsc into JSON with id and underscore keys
function parseRscToJson(localFile) {
  const data = fs.readFileSync(localFile, "utf-8");

  // 1. Reconstruct logical lines (handle \ continuation)
  const rawLines = data.split("\n");
  const commands = [];

  let buffer = "";

  for (let line of rawLines) {
    line = line.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith("#")) continue;

    if (line.endsWith("\\")) {
      buffer += line.slice(0, -1) + " ";
    } else {
      buffer += line;
      commands.push(buffer.trim());
      buffer = "";
    }
  }

  const profiles = [];
  let id = 1;

  // 2. Parse only "add" PPP profile commands
  for (const cmd of commands) {
    if (!cmd.startsWith("add ")) continue;

    const entry = {
      id: id++,
      disabled: "no",     // RouterOS default
      rate_limit: null,   // ensure consistency
    };

    // 3. Extract key=value pairs (quoted and unquoted).
    // \s* after = handles RouterOS line-continuation splits that leave a space
    // between the key and its value (e.g. name= "5M/8M").
    // The quoted alternative handles escaped characters inside quoted values.
    const regex = /([\w-]+)=\s*("(?:[^"\\]|\\.)*"|[^\s"=]+)/g;
    let match;

    while ((match = regex.exec(cmd)) !== null) {
      const key = match[1].replace(/-/g, "_");
      const value = match[2]
        .replace(/^"|"$/g, "")   // strip surrounding quotes
        .replace(/\\(.)/g, "$1") // unescape backslash sequences
        .trim();

      entry[key] = value;
    }

    profiles.push(entry);
  }

  return profiles;
}


// Trial for importing PPPoE profiles
function runMikrotikCommand(host, username, password, port, command) {
  return new Promise((resolve, reject) => {
    let output = "";

    const conn = new Client();

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }

          stream
            .on("data", (data) => {
              output += data.toString();
            })
            .on("close", () => {
              conn.end();
              resolve(output);
            });
        });
      })
      .on("error", reject)
      .connect({
        host,
        port,
        username,
        password,
      });
  });
}

function parsePppProfiles(output) {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const profiles = [];

  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;

    const id = Number(match[1]);
    const rest = match[2];

    const profile = {
      id,
      rate_limit: null, // ensure presence
    };

    const regex = /([\w-]+)=(".*?"|\S+)/g;
    let kv;

    while ((kv = regex.exec(rest)) !== null) {
      const key = kv[1].replace(/-/g, "_");
      const value = kv[2].replace(/^"|"$/g, "").trim();

      profile[key] = value;
    }

    profiles.push(profile);
  }

  return profiles;
}


// GET endpoint for PPPoE profiles (efficient version)
router.get("/router-pppoe-profiles-trial", async (req, res) => {
  const id = req.query.id;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      message: 'Missing or invalid "id" query parameter.',
    });
  }

  try {
    const response = await getRouterById(Number(id));

    if (!response.success) {
      return res.status(404).json({ message: "Router not found." });
    }

    const {
      ip_address: routerIP,
      username,
      router_secret: password,
      port = 22,
    } = response.data;

    // Execute MikroTik command directly
    const rawOutput = await runMikrotikCommand(
      routerIP,
      username,
      password,
      port,
      "/ppp profile print detail without-paging"
    );

    const profiles = parsePppProfiles(rawOutput);

    res.json(profiles);
  } catch (error) {
    console.error("❌ Error fetching PPPoE profiles:", error);
    res.status(500).json({
      error: "Failed to fetch PPPoE profiles",
      message: error.message,
    });
  }
});


// GET endpoint for PPPoE profiles
router.get("/router-pppoe-profiles", async (req, res) => {
  const id = req.query.id;

  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'Missing or invalid "id" query parameter.' });
  }

  try {
    const response = await getRouterById(Number(id)); // assumes you already have this function

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
    const profiles = parseRscToJson(localFile);

    // Clean up local file
    fs.unlinkSync(localFile);

    res.json(profiles);
  } catch (error) {
    console.error("❌ Error fetching PPPoE profiles:", error);
    res.status(500).json({ error: "Failed to fetch PPPoE profiles", message: error.message });
  }
});
// V3 Code Ends Here


// Route to get PPPoE plans using ID from query parameter
router.get('/router-pppoe-plans', async (req, res) => {
  const id = req.query.id;

  // Validate the ID
  if (!id || isNaN(id)) {
    return res.status(400).json({ message: 'Missing or invalid "id" query parameter.' });
  }

  try {
    const response = await getRouterById(Number(id));

    if (response.success === true) {
      const routerIP = response.data.ip_address;
      const username = response.data.username;
      const password = response.data.router_secret;

      const profiles = await listPPPoEPlans(routerIP, username, password);
      res.json(profiles);
    } else {
      res.status(404).json({ message: 'Router not found.' });
    }
  } catch (error) {
    console.error('Error in /router-pppoe-plans:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});


function listPPPoEPlans(ipAddress, username, password) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.exec('/ppp profile print without-paging', (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        let data = '';
        let errorData = '';

        stream.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });

        stream.stderr.on('data', (chunk) => {
          errorData += chunk.toString('utf8');
        });

        stream.on('close', () => {
          conn.end();

          if (errorData) {
            return reject(new Error(`Router command error: ${errorData}`));
          }

          try {
            const profiles = parsePPPProfiles(data);
            resolve(profiles);
          } catch (parseError) {
            reject(new Error(`Failed to parse router output: ${parseError.message}`));
          }
        });
      });
    });

    conn.on('error', (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    conn.connect({
      host: ipAddress,
      port: 22,
      username: username,
      password: password,
      readyTimeout: 10000
    });
  });
}

function parsePPPProfiles(output) {
  const profiles = [];

  // Split the output by profile entries (numbered lines)
  const profilePattern = /(\d+\s+\**\s+.*?)(?=\n\s*\d+\s+\**|\Z)/gs;
  const profileMatches = output.match(profilePattern) || [];

  for (const profileText of profileMatches) {
    const profile = {};

    // Get profile ID and default flag
    const idMatch = profileText.match(/^(\d+)\s+(\*?)/);
    if (idMatch) {
      profile.id = parseInt(idMatch[1], 10);
      profile.is_default = Boolean(idMatch[2]);
    }

    // Extract attributes using regex
    const nameMatch = profileText.match(/name="([^"]+)"/);
    if (nameMatch) {
      profile.name = nameMatch[1];
    }

    const localAddrMatch = profileText.match(/local-address=([^\s]+)/);
    if (localAddrMatch) {
      profile.local_address = localAddrMatch[1];
    }

    const remoteAddrMatch = profileText.match(/remote-address=([^\s]+)/);
    if (remoteAddrMatch) {
      profile.remote_address = remoteAddrMatch[1];
    }

    const rateLimitMatch = profileText.match(/rate-limit="([^"]+)"/);
    if (rateLimitMatch) {
      profile.rate_limit = rateLimitMatch[1];
    }

    const dnsMatch = profileText.match(/dns-server=([^\s]+)/);
    if (dnsMatch) {
      profile.dns_servers = dnsMatch[1].split(',');
    }

    // Extract other common attributes
    const commonAttrs = ["use-ipv6", "use-encryption", "use-compression"];
    commonAttrs.forEach(attr => {
      const attrMatch = profileText.match(new RegExp(`${attr}=([^\\s]+)`));
      if (attrMatch) {
        profile[attr.replace(/-/g, '_')] = attrMatch[1];
      }
    });

    profiles.push(profile);
  }

  return profiles;
}

// Import PPPOE Plans from router - Fewer Queries, better error handling, detailed logging
router.post('/router-import-pppoe-plans', verifyToken, async (req, res) => {
  const plansToImport = req.body;
  const this_user_id = req.userId;
  const this_company_id = req.company_id;
  const this_user_type = req.userType;
  let processedRouterId = null;

  console.log("Received Plans to Import: ", plansToImport);

  // --- Authorization: Limit PPPoE Plans Imports to admins and superadmins ---
  if (this_user_type !== 'admin' && this_user_type !== 'superadmin') {
    return res.status(403).json({ message: 'Unauthorized: Only admin or super_admin can import plans.' });
  }

  // --- Input Validation ---
  if (!Array.isArray(plansToImport)) {
    return res.status(400).json({ message: 'Invalid input: Expected an array of plans.' });
  }

  if (plansToImport.length === 0) {
    return res.status(400).json({ message: 'Invalid input: Plans array cannot be empty.' });
  }

  let createdCount = 0;
  let updatedCount = 0;
  const errors = []; // To collect any errors encountered during processing

  // --- Validate and prepare all plans, group by company_id and router_id for batching ---
  const groupedPlans = {}; // Key: `${company_id}_${router_id}`, Value: array of validated plans
  for (const plan of plansToImport) {
    try {
      // --- Data Extraction and Validation/Transformation ---
      const {
        name, // Frontend sends 'name', DB uses 'plan_name'
        plan_price,
        plan_validity, // In days from frontend
        router_id,
        company_id,
        company_username,
        rate_limit, // Frontend sends 'rate_limit', DB uses 'rate_limit_string'
        brand
      } = plan;

      // Store the first router_id (for logging, assuming mostly consistent)
      if (!processedRouterId) {
        processedRouterId = router_id;
      }

      // Basic validation for required fields from frontend payload
      if (!name || !plan_price || !plan_validity || !router_id || !company_id || !rate_limit || !company_username) {
        // Log the problematic plan and skip it
        console.warn('Skipping plan due to missing required fields:', plan);
        errors.push({ message: `Skipped plan "${name || 'N/A'}" due to missing required fields.`, planData: plan });
        continue; // Move to the next plan in the loop
      }

      // Convert validity from days to hours
      const validityInHours = parseInt(plan_validity, 10) * 24;
      if (isNaN(validityInHours)) {
        console.warn(`Skipping plan "${name}" due to invalid validity value:`, plan_validity);
        errors.push({ message: `Skipped plan "${name}" due to invalid validity value '${plan_validity}'.`, planData: plan });
        continue;
      }

      // Group by company_id and router_id (to handle batching per unique combo)
      const groupKey = `${company_id}_${router_id}`;
      if (!groupedPlans[groupKey]) {
        groupedPlans[groupKey] = [];
      }
      groupedPlans[groupKey].push({
        name,
        plan_price,
        validityInHours,
        router_id,
        company_id,
        company_username,
        rate_limit,
        brand
      });

    } catch (error) {
      // Log the error and the plan that caused it
      console.error(`Error processing plan: ${plan.name || JSON.stringify(plan)}`, error);
      errors.push({ message: `Failed to process plan "${plan.name || 'N/A'}": ${error.message}`, planData: plan });
      // Continue processing other plans even if one fails
    }
  }

  // --- Process each group (one bulk query per group to check exists, one bulk insert/update per group) ---
  for (const groupKey in groupedPlans) {
    const validPlans = groupedPlans[groupKey];
    const company_id = validPlans[0].company_id;
    const router_id = validPlans[0].router_id;
    const plan_names = validPlans.map(p => p.name);

    // --- Bulk check for existing plans in this group ---
    const checkQuery = 'SELECT plan_name FROM pppoe_plans WHERE plan_name IN (?) AND company_id = ? AND router_id = ?';
    const [existing] = await db.query(checkQuery, [plan_names, company_id, router_id]);

    const existingNames = new Set(existing.map(row => row.plan_name));
    updatedCount += existingNames.size;
    createdCount += validPlans.length - existingNames.size;

    // --- Prepare values for bulk insert/update ---
    const values = validPlans.map(plan => [
      plan.name,
      plan.plan_price,
      plan.validityInHours,
      plan.router_id,
      plan.company_id,
      plan.company_username,
      plan.rate_limit,
      plan.brand,
      'pppoe'
    ]);

    // --- Bulk insert with ON DUPLICATE KEY UPDATE (assumes UNIQUE KEY on (plan_name, company_id, router_id)) ---
    if (values.length > 0) {
      const insertQuery = `
                INSERT INTO pppoe_plans (
                    plan_name, plan_price, plan_validity, router_id,
                    company_id, company_username, rate_limit_string, brand, type
                ) VALUES ?
                ON DUPLICATE KEY UPDATE
                    plan_price = VALUES(plan_price),
                    plan_validity = VALUES(plan_validity),
                    router_id = VALUES(router_id),
                    rate_limit_string = VALUES(rate_limit_string),
                    brand = VALUES(brand),
                    type = VALUES(type)
            `;
      await db.query(insertQuery, [values]);
      console.log(`Processed batch for company ${company_id}, router ${router_id}: ${validPlans.length} plans`);
    }
  }

  // --- Send Response ---
  if (errors.length > 0) {
    // Partial success or complete failure
    res.status(errors.length === plansToImport.length ? 500 : 207) // 207 Multi-Status if partially successful
      .json({
        message: `Processed ${plansToImport.length} plans. See details below.`,
        created: createdCount,
        updated: updatedCount,
        failed: errors.length,
        errors: errors // Include details about failed plans
      });
  } else {

    // All plans processed successfully
    const comment = `imported of PPPOE plans from router ${processedRouterId} for company ${this_company_id}`;

    // Add a log of successful Imports
    const [plansImportsResult] = await db.execute(
      `INSERT INTO import_pppoe_plans_logs (comment, user_id, company_id) VALUES (?, ?, ?)`,
      [comment, this_user_id, this_company_id]
    );

    // Complete success
    res.status(200).json({
      message: `Successfully processed ${plansToImport.length} plans.`,
      created: createdCount,
      updated: updatedCount,
      log_id: plansImportsResult.insertId // Return the ID of the log entry
    });
  }
});

module.exports = router;
