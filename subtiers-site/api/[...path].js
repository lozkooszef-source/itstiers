const DEFAULT_API_ROOT = 'https://itstiers.vercel.app/api/v2';

const MODE_DEFS = [
  { id: 'minecart', apiId: 'cart', title: 'Minecart' },
  { id: 'dia_crystal', apiId: 'diamondcrystal', title: 'Diamond Crystal' },
  { id: 'debuff', apiId: 'debuff', title: 'DeBuff' },
  { id: 'elytra', apiId: 'elytra', title: 'Elytra' },
  { id: 'speed', apiId: 'speed', title: 'Speed' },
  { id: 'creeper', apiId: 'creeper', title: 'Creeper' },
  { id: 'manhunt', apiId: 'manhunt', title: 'Manhunt' },
  { id: 'chaosmace', apiId: 'chaosmace', title: 'ChaosMace' },
  { id: 'dia_smp', apiId: 'diamondsmp', title: 'Diamond SMP' },
  { id: 'bow', apiId: 'bow', title: 'Bow' },
  { id: 'bed', apiId: 'bed', title: 'Bed' },
  { id: 'og_vanilla', apiId: 'ogv', title: 'OG Vanilla' },
  { id: 'trident', apiId: 'trident', title: 'Trident' }
];

const MODE_BY_SUBTIERS_ID = new Map(MODE_DEFS.map((mode) => [mode.id, mode]));
const MODE_BY_API_ID = new Map(MODE_DEFS.map((mode) => [mode.apiId, mode]));

function apiRoot() {
  return (process.env.ITSTIERS_API_ROOT || process.env.NEXT_PUBLIC_API_ROOT || DEFAULT_API_ROOT).replace(/\/+$/, '');
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, body) {
  setCors(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requestPath(req) {
  const url = new URL(req.url, 'https://its-subtiers.local');
  return url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
}

function queryValue(req, key, fallback) {
  const url = new URL(req.url, 'https://its-subtiers.local');
  return url.searchParams.get(key) || fallback;
}

async function fetchItsTiers(path) {
  const response = await fetch(`${apiRoot()}${path}`);

  if (!response.ok) {
    const error = new Error(`ItsTiers API returned ${response.status}`);
    error.status = response.status;
    error.body = await response.text().catch(() => '');
    throw error;
  }

  return response.json();
}

function profileId(player) {
  return String(player.uuid || player.username || player.name || '').replace(/-/g, '');
}

function normalizeRanking(ranking) {
  if (!ranking) {
    return null;
  }

  return {
    tier: Number(ranking.tier),
    pos: Number(ranking.pos),
    peak_tier: ranking.peak_tier ?? null,
    peak_pos: ranking.peak_pos ?? null,
    attained: ranking.attained ?? null,
    retired: Boolean(ranking.retired)
  };
}

function subtierRankings(profile) {
  const rankings = {};

  for (const [apiModeId, ranking] of Object.entries(profile.rankings || {})) {
    const mode = MODE_BY_API_ID.get(apiModeId);

    if (mode) {
      rankings[mode.id] = normalizeRanking(ranking);
    }
  }

  return rankings;
}

function subtierProfile(profile) {
  return {
    uuid: profileId(profile),
    name: profile.name || profile.username,
    region: profile.region || 'EU',
    points: profile.points || 0,
    overall: profile.overall || 0,
    rankings: subtierRankings(profile),
    badges: []
  };
}

function playersMap(players) {
  return players.reduce((map, player) => {
    const id = profileId(player);

    map[id] = {
      name: player.name || player.username,
      region: player.region || 'EU',
      points: player.points || 0
    };

    return map;
  }, {});
}

async function tierlists() {
  return MODE_DEFS.reduce((entries, mode) => {
    entries[mode.id] = {
      title: mode.title,
      info_text: null,
      kit_image: null
    };

    return entries;
  }, {});
}

async function overall(req) {
  const from = queryValue(req, 'from', '0');
  const count = queryValue(req, 'count', '25');
  const players = await fetchItsTiers(`/mode/overall?group=subtiers&from=${encodeURIComponent(from)}&count=${encodeURIComponent(count)}`);

  return {
    rankings: players.map(profileId),
    players: playersMap(players)
  };
}

async function modeTier(req, modeId) {
  const mode = MODE_BY_SUBTIERS_ID.get(modeId);

  if (!mode) {
    return {
      rankings: [[], [], [], [], []],
      players: {}
    };
  }

  const from = queryValue(req, 'from', '0');
  const count = queryValue(req, 'count', '25');
  let columns;

  try {
    columns = await fetchItsTiers(`/mode/${mode.apiId}?group=subtiers&from=${encodeURIComponent(from)}&count=${encodeURIComponent(count)}`);
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }

    columns = {};
  }

  const rankings = [1, 2, 3, 4, 5].map((tier) => {
    return (columns[String(tier)] || []).map((player) => [profileId(player), Number(player.pos)]);
  });
  const players = Object.values(columns).flat();

  return {
    rankings,
    players: playersMap(players)
  };
}

async function rankings(identifier) {
  const profile = await fetchItsTiers(`/profile/${encodeURIComponent(identifier)}?group=subtiers`);
  return subtierRankings(profile);
}

async function profile(identifier) {
  const profile = await fetchItsTiers(`/profile/${encodeURIComponent(identifier)}?group=subtiers`);
  return subtierProfile(profile);
}

async function searchProfile(name) {
  const profile = await fetchItsTiers(`/profile/by-name/${encodeURIComponent(name)}?group=subtiers`);
  return subtierProfile(profile);
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const [resource, first] = requestPath(req);

    if (resource === 'tierlists') {
      sendJson(res, 200, await tierlists());
      return;
    }

    if (resource === 'tier' && first === 'overall') {
      sendJson(res, 200, await overall(req));
      return;
    }

    if (resource === 'tier' && first) {
      sendJson(res, 200, await modeTier(req, first));
      return;
    }

    if (resource === 'rankings' && first) {
      sendJson(res, 200, await rankings(first));
      return;
    }

    if (resource === 'profile' && first) {
      sendJson(res, 200, await profile(first));
      return;
    }

    if (resource === 'search_profile' && first) {
      sendJson(res, 200, await searchProfile(first));
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('ItsSubTiers API error:', error);
    sendJson(res, error.status === 404 ? 404 : 500, {
      error: error.status === 404 ? 'not_found' : 'internal_error'
    });
  }
};
