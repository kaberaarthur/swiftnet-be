const express = require('express');
const db = require("../dbPromise");
const { addBinding, setBindingType, removeActiveSession, disconnectTV } = require("./mikrotikService.js");
const { redeemVoucher, getRouterByID } = require("./services.js");

const router = express.Router();

// Example SSH config
const sshConfig = {
  host: "192.168.88.1",   // MikroTik IP
  username: "admin",
  password: "password",
  port: 22,
};

const normalizeMac = (mac) => mac.replace(/[^a-fA-F0-9]/g, '').match(/.{1,2}/g).join(':').toUpperCase();

// 1. Add new binding
// If a customer adds, remove the older TV associated with their number
router.post('/add', async (req, res) => {
  const { mac, voucher } = req.body;
  if (!mac || !voucher) {
    return res.status(400).json({ success: false, error: 'MAC and voucher are required' });
  }

  const macNorm = normalizeMac(mac);

  try {
    // 1) Redeem voucher
    const voucherResult = await redeemVoucher(voucher);
    if (!voucherResult.success) {
      return res.status(400).json({ success: false, error: voucherResult.message || 'Voucher redeem failed' });
    }

    const phoneNumber = voucherResult.voucher.customer || null;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Voucher does not contain a valid phone number' });
    }

    // 2) Get Router Details
    const routerDetails = await getRouterByID(voucherResult.voucher.router_id);
    if (!routerDetails.success) {
      return res.status(400).json({ success: false, error: routerDetails.message || 'Failed to get router details' });
    }

    const sshConfig = {
      host: routerDetails.data.ip_address,
      username: routerDetails.data.username,
      password: routerDetails.data.router_secret,
      port: routerDetails.data.port || 22,
    };

    let oldMac = null;

    // 3) Insert or Update TV in database using ON DUPLICATE KEY UPDATE
    try {
      const [result] = await db.execute(
        `INSERT INTO tvs (mac_address, binding_type, phone_number, voucher_id, router_id, end_date, updated_at)
         VALUES (?, 'bypassed', ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           phone_number = VALUES(phone_number),
           voucher_id = VALUES(voucher_id),
           binding_type = VALUES(binding_type),
           end_date = VALUES(end_date),
           updated_at = CURRENT_TIMESTAMP`,
        [
          macNorm,
          phoneNumber,
          voucherResult.voucher.id,
          routerDetails.data.id,
          voucherResult.voucher.end_date
        ]
      );

      // If it was an update, fetch the old MAC for cleanup
      if (result.affectedRows > 1) {
        // Means an update happened (insert + update counts as 2)
        const [existing] = await db.execute(
          `SELECT mac_address FROM tvs WHERE phone_number = ? AND router_id = ?`,
          [phoneNumber, routerDetails.data.id]
        );
        if (existing.length > 0) {
          oldMac = existing[0].mac_address;
        }
      }
    } catch (dbErr) {
      console.error("DB Error inserting/updating TV:", dbErr);
      return res.status(500).json({ success: false, error: "Failed to register TV in database." });
    }

    // 4) Add/Update binding on router
    try {
      await addBinding(
        sshConfig,
        macNorm,
        'bypassed',
        phoneNumber,
        voucherResult.voucher.end_date
      );
    } catch (addErr) {
      console.error('Error setting/adding binding:', addErr);
      return res.status(500).json({
        success: false,
        error: 'Failed to set or add binding on MikroTik.'
      });
    }

    // 5) If oldMac exists, remove its binding and active session
    if (oldMac && oldMac !== macNorm) {
      const oldMacNorm = normalizeMac(oldMac);
      try {
        await removeActiveSession(sshConfig, oldMacNorm);
      } catch (removeErr) {
        console.error('Error removing old binding or session:', removeErr);
        // Not critical, don’t fail the request
      }
    }

    return res.json({
      success: true,
      message: 'Voucher redeemed and device bypassed. Device should reconnect automatically.',
      mac: macNorm,
      oldMac
    });

  } catch (err) {
    console.error('Error adding bypass:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to add bypass' });
  }
});


// If user already has an existing binding, readd the TV
// To only be used within the system not externally
router.post("/reconnect", async (req, res) => {
  const { phone_number, shared_users } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: "phone_number is required" });
  }

  try {
    // 🔹 Query TV records by phone number
    const [rows] = await db.execute(
      "SELECT id, mac_address, created_at FROM tvs WHERE phone_number = ?",
      [phone_number]
    );

    if (rows.length === 0) {
      return res.status(200).json({ success: "No TV found with that phone number" });
    }

    // Add binding for each TV found
    for (const tv of rows) {
      const macNorm = normalizeMac(tv.mac_address);
      await addBinding(sshConfig, macNorm, "bypassed", phone_number);
    }
    res.json({ success: true, message: `${rows.length} TV(s) reconnected.` });

  } catch (error) {
    console.error("Error fetching TV:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// 2. Disconnect (kick device off active session)
router.post("/disconnect", async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: "MAC address required" });
  try {
    // Remove active session
    const result = await removeActiveSession(sshConfig, mac);

    // Set device to blocked
    await setBindingType(sshConfig, mac, "blocked");

    res.json({ success: true, action: "disconnect", mac, result  });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Connect (switch from blocked → bypassed)
router.post("/connect", async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: "MAC address required" });
  try {
    await setBindingType(sshConfig, mac, "bypassed");
    await removeActiveSession(sshConfig, mac); // force reconnect
    res.json({ success: true, action: "connect", mac });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Block (switch to blocked)
router.post("/block", async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: "MAC address required" });
  try {
    await setBindingType(sshConfig, mac, "blocked");
    await removeActiveSession(sshConfig, mac); // force disconnect
    res.json({ success: true, action: "block", mac });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Disconnect all Expired TVs
router.post("/disconnect-many", async (req, res) => {
  try {
    // 🔹 Fetch only premium routers
    const [routers] = await db.execute(
      "SELECT * FROM routers WHERE premium_hotspot = 1"
    );

    // 🔹 Current timestamp (Nairobi)
    const currTime = Math.floor(Date.now() / 1000) + (3 * 60 * 60);

    // 🔹 Run disconnectTV for each router
    const results = await Promise.allSettled(
      routers.map((router) => {
        const sshConfig = {
          host: router.ip_address,
          username: router.username,
          port: router.port || 22,
          password: router.router_secret,
        };

        return disconnectTV(sshConfig).then(() => ({
          id: router.id,
          router_name: router.router_name,
        }));
      })
    );

    // 🔹 Extract successes & failures
    const successes = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const failures = results
      .filter((r) => r.status === "rejected")
      .map((r, i) => ({
        id: routers[i].id,
        router_name: routers[i].router_name,
      }));

    res.json({
      success: true,
      successes,
      failures,
    });
  } catch (err) {
    console.error("Error disconnecting TVs:", err);
    res.status(500).json({ success: false, error: "Failed to disconnect TVs" });
  }
});

module.exports = router;
