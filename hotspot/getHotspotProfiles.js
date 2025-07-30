const { Client } = require('ssh2');
const { runSSHCommand } = require('./sshCommand');

function parseProfiles(rawOutput) {
  const profiles = [];
  let current = {};
  const lines = rawOutput.split('\n');

  for (let line of lines) {
    line = line.trim();

    if (!line || line.startsWith('Flags:')) continue;

    // If line starts with a number (e.g. "0", "1", "2"), it's a new entry
    if (/^\d/.test(line)) {
      if (Object.keys(current).length > 0) {
        profiles.push(current);
      }
      current = {};
      line = line.replace(/^\d+\s+\*?/, '').trim(); // remove index and optional "*"
    }

    // Match key=value or key="quoted value"
    const regex = /([\w-]+)=("[^"]*"|\S+)/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const key = match[1];
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      current[key] = value;
    }
  }

  if (Object.keys(current).length > 0) {
    profiles.push(current);
  }

  return profiles;
}
async function getHotspotProfiles({ host, port, username, password }) {
  const sshCommand = '/ip hotspot user profile print without-paging'; 
  const sshOutput = await runSSHCommand(sshCommand, host, username, password, port);
  const profiles = parseProfiles(sshOutput);
  return profiles;
}

module.exports = {
    getHotspotProfiles
};