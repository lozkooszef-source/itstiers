const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

const configPath = path.resolve(rootDir, process.env.CONFIG_PATH || './config.json');
const dataPath = path.resolve(rootDir, process.env.DATA_PATH || './data/state.json');

let bundledConfig = null;
let bundledExampleConfig = null;

try {
  bundledConfig = require('../config.json');
} catch (error) {
  bundledConfig = null;
}

try {
  bundledExampleConfig = require('../config.example.json');
} catch (error) {
  bundledExampleConfig = null;
}

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    const basename = path.basename(filePath);

    if (basename === 'config.json' && bundledConfig) {
      return bundledConfig;
    }

    if (basename === 'config.example.json' && bundledExampleConfig) {
      return bundledExampleConfig;
    }

    throw new Error(
      `Missing ${path.basename(filePath)}. Copy config.example.json to config.json and fill your Discord IDs.`
    );
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const config = readJson(configPath);

function optionalDiscordId(value, name) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const id = String(value).trim();

  if (!/^\d{15,25}$/.test(id)) {
    throw new ConfigError(
      `Invalid ${name}: "${id}". Open config.json and replace it with a real Discord ID. Discord IDs are digits only.`
    );
  }

  return id;
}

function requiredDiscordId(value, name) {
  const id = optionalDiscordId(value, name);

  if (!id) {
    throw new ConfigError(`Missing ${name}. Open config.json and add the Discord ID.`);
  }

  return id;
}

function optionalDiscordIdArray(values, name) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value, index) => optionalDiscordId(value, `${name}[${index}]`))
    .filter(Boolean);
}

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} in .env.`);
  }

  return value;
}

function getGuildId() {
  return process.env.GUILD_ID || config.guildId;
}

module.exports = {
  rootDir,
  configPath,
  dataPath,
  config,
  ConfigError,
  optionalDiscordId,
  optionalDiscordIdArray,
  requiredDiscordId,
  token: () => requireEnv('DISCORD_TOKEN'),
  clientId: () => requireEnv('CLIENT_ID'),
  guildId: getGuildId
};
