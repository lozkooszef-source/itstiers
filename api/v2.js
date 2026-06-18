const {
  itstiersMode,
  itstiersModeList,
  itstiersOverall,
  itstiersProfile
} = require('../src/api/itstiersCompat');
const { hasDatabase, query } = require('../src/db/pool');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  setCors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function pathParts(req) {
  const value = req.query.path;

  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry).split('/')).filter(Boolean);
  }

  return String(value || '').split('/').filter(Boolean);
}

async function resolveMinecraftUuid(identifier) {
  const value = String(identifier || '').trim();
  const compactUuid = value.replace(/-/g, '');

  if (/^[0-9a-f]{32}$/i.test(compactUuid)) {
    return compactUuid;
  }

  const response = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(value)}`
  );

  if (!response.ok) {
    return value;
  }

  const profile = await response.json();
  return profile.id || value;
}

async function pvpClub(res, identifier) {
  const token = process.env.PVPCLUB_TOKEN;

  if (!token) {
    json(res, 404, { error: 'pvpclub_disabled' });
    return;
  }

  const uuid = await resolveMinecraftUuid(identifier);
  const upstream = await fetch(
    `https://api.mcpvp.club/v1/customname?uuid=${encodeURIComponent(uuid)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  const body = await upstream.text();

  setCors(res);
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  res.end(body);
}

async function health() {
  const result = {
    ok: true,
    databaseConfigured: hasDatabase(),
    databaseSsl: process.env.DATABASE_SSL === 'true',
    tables: {
      players: false,
      testResults: false,
      waitlistSnapshots: false
    }
  };

  if (!result.databaseConfigured) {
    return result;
  }

  try {
    const tables = await query(
      `
        SELECT
          to_regclass('public.players') AS players,
          to_regclass('public.test_results') AS test_results,
          to_regclass('public.waitlist_snapshots') AS waitlist_snapshots
      `
    );
    const row = tables.rows[0] || {};

    result.tables.players = Boolean(row.players);
    result.tables.testResults = Boolean(row.test_results);
    result.tables.waitlistSnapshots = Boolean(row.waitlist_snapshots);

    if (result.tables.testResults) {
      const count = await query('SELECT COUNT(*)::int AS count FROM test_results');
      result.resultCount = count.rows[0]?.count || 0;
    }

    return result;
  } catch (error) {
    return {
      ok: false,
      databaseConfigured: true,
      databaseSsl: process.env.DATABASE_SSL === 'true',
      error: {
        code: error.code || error.name || 'unknown',
        message: error.message
      }
    };
  }
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const parts = pathParts(req);
    const [resource, first, second] = parts;

    if (resource === 'health') {
      json(res, 200, await health());
      return;
    }

    if (resource === 'mode' && first === 'list') {
      json(res, 200, await itstiersModeList());
      return;
    }

    if (resource === 'mode' && first === 'overall') {
      json(res, 200, await itstiersOverall(req.query.from, req.query.count));
      return;
    }

    if (resource === 'mode' && first) {
      const mode = await itstiersMode(first, req.query.from, req.query.count);

      if (!mode) {
        json(res, 404, { error: 'mode_not_found' });
        return;
      }

      json(res, 200, mode);
      return;
    }

    if (resource === 'profile' && first === 'by-name' && second) {
      const profile = await itstiersProfile(second);

      if (!profile) {
        json(res, 404, { error: 'player_not_found' });
        return;
      }

      json(res, 200, profile);
      return;
    }

    if (resource === 'profile' && first) {
      const profile = await itstiersProfile(first);

      if (!profile) {
        json(res, 404, { error: 'player_not_found' });
        return;
      }

      json(res, 200, profile);
      return;
    }

    if (resource === 'pvpclub' && first) {
      await pvpClub(res, first);
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('Vercel API error:', error);
    json(res, 500, { error: 'internal_error' });
  }
};
