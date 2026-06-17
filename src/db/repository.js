const { hasDatabase, query } = require('./pool');
const { loadState } = require('../storage/state');
const { config } = require('../config');
const { minecraftAvatarUrl } = require('../utils/format');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

function limitValue(value) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

function resultToDbRow(result) {
  return {
    discordId: result.userId,
    testerDiscordId: result.testerId,
    minecraftUsername: result.username,
    discordAvatarUrl: result.discordAvatarUrl || null,
    region: result.server,
    modeId: result.modeId,
    modeName: result.modeName,
    previousTier: result.previousTier || null,
    earnedTier: result.tier,
    requestedAt: result.requestedAt || null,
    startedAt: result.startedAt || null,
    closedAt: result.closedAt,
    ticketChannelId: result.ticketChannelId || null,
    skinRenderUrl: minecraftAvatarUrl(result.username),
    raw: result
  };
}

function dbResultToApi(row) {
  return {
    id: row.id,
    discordId: row.discord_id,
    testerDiscordId: row.tester_discord_id,
    minecraftUsername: row.minecraft_username,
    discordAvatarUrl: row.discord_avatar_url,
    region: row.region,
    modeId: row.mode_id,
    modeName: row.mode_name,
    previousTier: row.previous_tier,
    earnedTier: row.earned_tier,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    ticketChannelId: row.ticket_channel_id,
    skinRenderUrl: row.skin_render_url
  };
}

function stateResultToApi(result, index) {
  return {
    id: index + 1,
    discordId: result.userId,
    testerDiscordId: result.testerId,
    minecraftUsername: result.username,
    discordAvatarUrl: result.discordAvatarUrl || null,
    region: result.server,
    modeId: result.modeId,
    modeName: result.modeName,
    previousTier: result.previousTier || null,
    earnedTier: result.tier,
    requestedAt: result.requestedAt || null,
    startedAt: result.startedAt || null,
    closedAt: result.closedAt,
    ticketChannelId: result.ticketChannelId || null,
    skinRenderUrl: minecraftAvatarUrl(result.username)
  };
}

async function savePlayer(player) {
  if (!hasDatabase()) {
    return;
  }

  try {
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
      [
        player.discordId,
        player.minecraftUsername,
        player.discordAvatarUrl || null,
        player.verifiedAt || new Date().toISOString()
      ]
    );
  } catch (error) {
    console.error('PostgreSQL savePlayer failed:', error.message);
  }
}

async function saveResult(result) {
  if (!hasDatabase()) {
    return;
  }

  const row = resultToDbRow(result);

  try {
    await savePlayer({
      discordId: row.discordId,
      minecraftUsername: row.minecraftUsername,
      discordAvatarUrl: row.discordAvatarUrl,
      verifiedAt: result.requestedAt || result.closedAt
    });

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
  } catch (error) {
    console.error('PostgreSQL saveResult failed:', error.message);
  }
}

async function saveWaitlistSnapshot(mode, modeState) {
  if (!hasDatabase()) {
    return;
  }

  try {
    await query(
      `
        INSERT INTO waitlist_snapshots (
          mode_id,
          mode_name,
          open,
          queue,
          waitlist,
          active_testers,
          active_tests,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (mode_id)
        DO UPDATE SET
          mode_name = EXCLUDED.mode_name,
          open = EXCLUDED.open,
          queue = EXCLUDED.queue,
          waitlist = EXCLUDED.waitlist,
          active_testers = EXCLUDED.active_testers,
          active_tests = EXCLUDED.active_tests,
          updated_at = NOW()
      `,
      [
        mode.id,
        mode.name,
        Boolean(modeState.open),
        JSON.stringify(modeState.queue || []),
        JSON.stringify(modeState.waitlist || []),
        JSON.stringify(modeState.activeTesters || []),
        JSON.stringify(modeState.activeTests || [])
      ]
    );
  } catch (error) {
    console.error('PostgreSQL saveWaitlistSnapshot failed:', error.message);
  }
}

function stateResults(filters = {}) {
  const state = loadState();
  const limit = limitValue(filters.limit);
  const username = filters.username?.toLowerCase();
  const mode = filters.mode?.toLowerCase();
  const discordId = filters.discordId;

  return state.results
    .map(stateResultToApi)
    .filter((result) => {
      if (username && result.minecraftUsername.toLowerCase() !== username) {
        return false;
      }

      if (mode && result.modeId.toLowerCase() !== mode && result.modeName.toLowerCase() !== mode) {
        return false;
      }

      if (discordId && result.discordId !== discordId) {
        return false;
      }

      return true;
    })
    .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())
    .slice(0, limit);
}

async function listResults(filters = {}) {
  if (!hasDatabase()) {
    return stateResults(filters);
  }

  const where = [];
  const params = [];

  if (filters.username) {
    params.push(filters.username.toLowerCase());
    where.push(`LOWER(minecraft_username) = $${params.length}`);
  }

  if (filters.mode) {
    params.push(filters.mode.toLowerCase());
    where.push(`(LOWER(mode_id) = $${params.length} OR LOWER(mode_name) = $${params.length})`);
  }

  if (filters.discordId) {
    params.push(filters.discordId);
    where.push(`discord_id = $${params.length}`);
  }

  params.push(limitValue(filters.limit));

  const result = await query(
    `
      SELECT *
      FROM test_results
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY closed_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(dbResultToApi);
}

function stateWaitlists() {
  const state = loadState();

  return config.modes.map((mode) => {
    const modeState = state.waitlists[mode.id] || {};

    return {
      modeId: mode.id,
      modeName: mode.name,
      open: Boolean(modeState.open),
      queue: modeState.queue || [],
      waitlist: modeState.waitlist || [],
      activeTesters: modeState.activeTesters || [],
      activeTests: modeState.activeTests || [],
      updatedAt: null
    };
  });
}

async function listWaitlists() {
  if (!hasDatabase()) {
    return stateWaitlists();
  }

  const result = await query('SELECT * FROM waitlist_snapshots ORDER BY mode_name ASC');

  if (!result.rows.length) {
    return stateWaitlists();
  }

  return result.rows.map((row) => ({
    modeId: row.mode_id,
    modeName: row.mode_name,
    open: row.open,
    queue: row.queue,
    waitlist: row.waitlist,
    activeTesters: row.active_testers,
    activeTests: row.active_tests,
    updatedAt: row.updated_at
  }));
}

async function getPlayer(identifier) {
  const normalized = String(identifier || '').toLowerCase();

  if (!hasDatabase()) {
    const results = stateResults({ limit: MAX_LIMIT }).filter((result) => {
      return result.discordId === identifier || result.minecraftUsername.toLowerCase() === normalized;
    });

    if (!results.length) {
      return null;
    }

    return {
      discordId: results[0].discordId,
      minecraftUsername: results[0].minecraftUsername,
      discordAvatarUrl: results[0].discordAvatarUrl,
      latestResults: results
    };
  }

  const player = await query(
    `
      SELECT *
      FROM players
      WHERE discord_id = $1 OR LOWER(minecraft_username) = $2
      LIMIT 1
    `,
    [identifier, normalized]
  );

  if (!player.rows.length) {
    return null;
  }

  const latestResults = await listResults({
    discordId: player.rows[0].discord_id,
    limit: MAX_LIMIT
  });

  return {
    discordId: player.rows[0].discord_id,
    minecraftUsername: player.rows[0].minecraft_username,
    discordAvatarUrl: player.rows[0].discord_avatar_url,
    verifiedAt: player.rows[0].verified_at,
    latestResults
  };
}

async function leaderboard(filters = {}) {
  if (!hasDatabase()) {
    const latestByPlayerMode = new Map();

    for (const result of stateResults({ ...filters, limit: MAX_LIMIT })) {
      const key = `${result.discordId}:${result.modeId}`;

      if (!latestByPlayerMode.has(key)) {
        latestByPlayerMode.set(key, result);
      }
    }

    return [...latestByPlayerMode.values()].slice(0, limitValue(filters.limit));
  }

  const params = [];
  const where = [];

  if (filters.mode) {
    params.push(filters.mode.toLowerCase());
    where.push(`(LOWER(mode_id) = $${params.length} OR LOWER(mode_name) = $${params.length})`);
  }

  params.push(limitValue(filters.limit));

  const result = await query(
    `
      SELECT *
      FROM (
        SELECT DISTINCT ON (discord_id, mode_id) *
        FROM test_results
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY discord_id, mode_id, closed_at DESC
      ) latest
      ORDER BY closed_at DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(dbResultToApi);
}

module.exports = {
  getPlayer,
  leaderboard,
  listResults,
  listWaitlists,
  savePlayer,
  saveResult,
  saveWaitlistSnapshot
};
