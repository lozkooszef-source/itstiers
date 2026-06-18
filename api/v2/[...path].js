const {
  mctiersMode,
  mctiersModeList,
  mctiersOverall,
  mctiersProfile
} = require('../../src/api/mctiersCompat');

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
    return value.filter(Boolean);
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

async function pvpClub(req, res, identifier) {
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

    if (resource === 'mode' && first === 'list') {
      json(res, 200, await mctiersModeList());
      return;
    }

    if (resource === 'mode' && first === 'overall') {
      json(res, 200, await mctiersOverall(req.query.from, req.query.count));
      return;
    }

    if (resource === 'mode' && first) {
      const mode = await mctiersMode(first, req.query.from, req.query.count);

      if (!mode) {
        json(res, 404, { error: 'mode_not_found' });
        return;
      }

      json(res, 200, mode);
      return;
    }

    if (resource === 'profile' && first === 'by-name' && second) {
      const profile = await mctiersProfile(second);

      if (!profile) {
        json(res, 404, { error: 'player_not_found' });
        return;
      }

      json(res, 200, profile);
      return;
    }

    if (resource === 'profile' && first) {
      const profile = await mctiersProfile(first);

      if (!profile) {
        json(res, 404, { error: 'player_not_found' });
        return;
      }

      json(res, 200, profile);
      return;
    }

    if (resource === 'pvpclub' && first) {
      await pvpClub(req, res, first);
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('Vercel API error:', error);
    json(res, 500, { error: 'internal_error' });
  }
};
