const fs = require('node:fs/promises');
const path = require('node:path');
const { config, dataPath, rootDir } = require('../config');
const { minecraftAvatarUrl } = require('../utils/format');
const { closePool, hasDatabase, query } = require('./pool');
const { runMigrations } = require('./migrate');

function resolveInputPath(input) {
  if (!input) {
    return dataPath;
  }

  return path.isAbsolute(input) ? input : path.resolve(rootDir, input);
}

function findMode(modeId, modeName) {
  const rawId = String(modeId || '').toLowerCase();
  const rawName = String(modeName || '').toLowerCase();

  return config.modes.find((mode) => {
    return mode.id.toLowerCase() === rawId || mode.name.toLowerCase() === rawName;
  });
}

function resultToRow(result) {
  const mode = findMode(result.modeId, result.modeName);
  const username = String(result.username || '').trim();

  if (!username || !result.userId || !result.testerId || !result.tier || !result.closedAt) {
    return null;
  }

  return {
    discordId: String(result.userId),
    testerDiscordId: String(result.testerId),
    minecraftUsername: username,
    discordAvatarUrl: result.discordAvatarUrl || null,
    region: String(result.server || 'EU'),
    modeId: result.modeId || mode?.id || 'unknown',
    modeName: result.modeName || mode?.name || result.modeId || 'Unknown',
    previousTier: result.previousTier || null,
    earnedTier: result.tier,
    requestedAt: result.requestedAt || null,
    startedAt: result.startedAt || null,
    closedAt: result.closedAt,
    ticketChannelId: result.ticketChannelId || null,
    skinRenderUrl: result.skinRenderUrl || minecraftAvatarUrl(username),
    raw: result
  };
}

async function saveImportedPlayer(discordId, username, discordAvatarUrl, verifiedAt) {
  await query(
    `
      INSERT INTO players (discord_id, minecraft_username, discord_avatar_url, verified_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (discord_id)
      DO UPDATE SET
        minecraft_username = EXCLUDED.minecraft_username,
        discord_avatar_url = COALESCE(EXCLUDED.discord_avatar_url, players.discord_avatar_url),
        verified_at = COALESCE(players.verified_at, EXCLUDED.verified_at),
        updated_at = NOW()
    `,
    [discordId, username, discordAvatarUrl || null, verifiedAt || null]
  );
}

async function importedResultExists(row) {
  const existing = await query(
    `
      SELECT id
      FROM test_results
      WHERE discord_id = $1
        AND mode_id = $2
        AND minecraft_username = $3
        AND earned_tier = $4
        AND closed_at = $5
      LIMIT 1
    `,
    [row.discordId, row.modeId, row.minecraftUsername, row.earnedTier, row.closedAt]
  );

  return existing.rowCount > 0;
}

async function saveImportedResult(row) {
  await saveImportedPlayer(
    row.discordId,
    row.minecraftUsername,
    row.discordAvatarUrl,
    row.requestedAt || row.closedAt
  );

  if (await importedResultExists(row)) {
    return false;
  }

  await query(
    `
      INSERT INTO test_results (
        discord_id,
        tester_discord_id,
        minecraft_username,
        discord_avatar_url,
        region,
        mode_id,
        mode_name,
        previous_tier,
        earned_tier,
        requested_at,
        started_at,
        closed_at,
        ticket_channel_id,
        skin_render_url,
        raw
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
    `,
    [
      row.discordId,
      row.testerDiscordId,
      row.minecraftUsername,
      row.discordAvatarUrl,
      row.region,
      row.modeId,
      row.modeName,
      row.previousTier,
      row.earnedTier,
      row.requestedAt,
      row.startedAt,
      row.closedAt,
      row.ticketChannelId,
      row.skinRenderUrl,
      JSON.stringify(row.raw)
    ]
  );

  return true;
}

async function importState(inputPath) {
  if (!hasDatabase()) {
    throw new Error('DATABASE_URL is missing. Set it before importing state.');
  }

  const filePath = resolveInputPath(inputPath);
  const state = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const verifiedAccounts = Object.entries(state.verifiedAccounts || {});
  const results = Array.isArray(state.results) ? state.results : [];

  await runMigrations();

  let importedPlayers = 0;
  let importedResults = 0;
  let skippedResults = 0;

  for (const [discordId, account] of verifiedAccounts) {
    const username = String(account.username || '').trim();

    if (!username) {
      continue;
    }

    await saveImportedPlayer(discordId, username, account.discordAvatarUrl || null, account.verifiedAt || null);
    importedPlayers += 1;
  }

  for (const result of results) {
    const row = resultToRow(result);

    if (!row) {
      skippedResults += 1;
      continue;
    }

    const inserted = await saveImportedResult(row);

    if (inserted) {
      importedResults += 1;
    } else {
      skippedResults += 1;
    }
  }

  return {
    filePath,
    importedPlayers,
    importedResults,
    skippedResults
  };
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: npm run import-state -- [path/to/state.json]');
    console.log('Set DATABASE_URL and DATABASE_SSL=true before importing.');
    process.exit(0);
  }

  importState(process.argv[2])
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

module.exports = {
  importState
};
