const { config } = require('../config');
const { listResults } = require('../db/repository');
const { minecraftAvatarUrl } = require('../utils/format');

const POINTS = {
  1: { high: 60, low: 45 },
  2: { high: 30, low: 20 },
  3: { high: 10, low: 6 },
  4: { high: 4, low: 3 },
  5: { high: 2, low: 1 }
};

const MODE_ALIASES = new Map([
  ['ltm', 'crystal'],
  ['2v2', 'crystal'],
  ['vanilla', 'crystal'],
  ['nethop', 'netpot'],
  ['netop', 'netpot'],
  ['chaos-mace', 'chaosmace'],
  ['chaos_mace', 'chaosmace'],
  ['spear-mace', 'spearmace'],
  ['spear_mace', 'spearmace'],
  ['og-vanilla', 'ogv'],
  ['og_vanilla', 'ogv'],
  ['ogvanilla', 'ogv'],
  ['dia-crystal', 'diamondcrystal'],
  ['dia_crystal', 'diamondcrystal'],
  ['diamond-crystal', 'diamondcrystal'],
  ['diamond_crystal', 'diamondcrystal'],
  ['dia-smp', 'diamondsmp'],
  ['dia_smp', 'diamondsmp'],
  ['diamond-smp', 'diamondsmp'],
  ['diamond_smp', 'diamondsmp'],
  ['minecart', 'cart']
]);

const MAIN_MODE_IDS = new Set([
  'crystal',
  'uhc',
  'pot',
  'netpot',
  'smp',
  'sword',
  'axe',
  'mace',
  'spearmace'
]);

const SUBTIERS_MODE_IDS = new Set([
  'chaosmace',
  'speed',
  'ogv',
  'diamondcrystal',
  'diamondsmp',
  'bow',
  'cart',
  'elytra',
  'creeper',
  'debuff',
  'trident',
  'manhunt',
  'bed'
]);

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeRegion(value) {
  const region = String(value || 'EU').trim().toUpperCase();
  return region || 'EU';
}

function findMode(input) {
  const raw = String(input || '').toLowerCase();
  const normalized = normalize(input);
  const target = MODE_ALIASES.get(raw) || MODE_ALIASES.get(normalized) || normalized;

  return config.modes.find((mode) => {
    return normalize(mode.id) === target
      || normalize(mode.name) === target;
  });
}

function resolveModeGroup(value) {
  const group = String(value || 'main').toLowerCase();

  if (group === 'subtiers' || group === 'subtier' || group === 'custom') {
    return 'subtiers';
  }

  if (group === 'all') {
    return 'all';
  }

  return 'main';
}

function modeGroupSet(group) {
  const resolved = resolveModeGroup(group);

  if (resolved === 'all') {
    return null;
  }

  return resolved === 'subtiers' ? SUBTIERS_MODE_IDS : MAIN_MODE_IDS;
}

function isModeInGroup(modeId, group) {
  const allowed = modeGroupSet(group);
  return !allowed || allowed.has(normalize(modeId));
}

function limitValue(value, fallback = 10) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 0), 100);
}

function tierToRanking(tierText) {
  const text = String(tierText || '').trim();
  const match = text.match(/^(High|Low)\s+Tier\s+([1-5])$/i)
    || text.match(/^(H|L)T\s*([1-5])$/i);

  if (!match) {
    return null;
  }

  const position = match[1].toLowerCase().startsWith('h') ? 0 : 1;

  return {
    tier: Number.parseInt(match[2], 10),
    pos: position,
    peak_tier: null,
    peak_pos: null,
    retired: false
  };
}

function rankingPoints(ranking) {
  if (!ranking) {
    return 0;
  }

  return POINTS[ranking.tier]?.[ranking.pos === 0 ? 'high' : 'low'] || 0;
}

function rankingSortValue(ranking) {
  if (!ranking) {
    return Number.POSITIVE_INFINITY;
  }

  return ranking.tier * 10 + ranking.pos;
}

function isBetterRanking(candidate, current) {
  return rankingSortValue(candidate) < rankingSortValue(current);
}

function playerKey(result) {
  return result.discordId || result.minecraftUsername.toLowerCase();
}

function publicUuid(result) {
  return result.minecraftUsername;
}

function emptyColumns() {
  return {
    1: [],
    2: [],
    3: [],
    4: [],
    5: []
  };
}

async function getAllResults() {
  return listResults({ limit: 1000 });
}

function buildProfiles(results, group = 'main') {
  const players = new Map();
  const latestByPlayerMode = new Map();
  const bestByPlayerMode = new Map();

  for (const result of results) {
    const ranking = tierToRanking(result.earnedTier);

    if (!ranking) {
      continue;
    }

    const key = playerKey(result);
    const modeKey = normalize(result.modeId);

    if (!isModeInGroup(modeKey, group)) {
      continue;
    }

    const playerModeKey = `${key}:${modeKey}`;
    const currentLatest = latestByPlayerMode.get(playerModeKey);
    const currentBest = bestByPlayerMode.get(playerModeKey);

    if (!currentLatest || new Date(result.closedAt).getTime() > new Date(currentLatest.result.closedAt).getTime()) {
      latestByPlayerMode.set(playerModeKey, { result, ranking });
    }

    if (!currentBest || isBetterRanking(ranking, currentBest.ranking)) {
      bestByPlayerMode.set(playerModeKey, { result, ranking });
    }

    if (!players.has(key)) {
      players.set(key, {
        discordId: result.discordId,
        uuid: publicUuid(result),
        name: result.minecraftUsername,
        username: result.minecraftUsername,
        region: normalizeRegion(result.region),
        discordAvatarUrl: result.discordAvatarUrl || null,
        skinRenderUrl: result.skinRenderUrl || minecraftAvatarUrl(result.minecraftUsername),
        rankings: {}
      });
    }
  }

  for (const [playerModeKey, latest] of latestByPlayerMode.entries()) {
    const [, modeKey] = playerModeKey.split(':');
    const player = players.get(playerKey(latest.result));
    const best = bestByPlayerMode.get(playerModeKey);
    const ranking = { ...latest.ranking };

    if (best && isBetterRanking(best.ranking, latest.ranking)) {
      ranking.peak_tier = best.ranking.tier;
      ranking.peak_pos = best.ranking.pos;
    }

    player.rankings[modeKey] = ranking;
  }

  const profiles = [...players.values()].map((profile) => {
    const points = Object.values(profile.rankings).reduce((total, ranking) => {
      return total + rankingPoints(ranking);
    }, 0);

    return {
      ...profile,
      points,
      overall: 0
    };
  });

  profiles.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    return a.name.localeCompare(b.name);
  });

  profiles.forEach((profile, index) => {
    profile.overall = index + 1;
  });

  return profiles;
}

function publicProfile(profile) {
  return {
    uuid: profile.uuid,
    name: profile.name,
    username: profile.username,
    region: profile.region,
    points: profile.points,
    overall: profile.overall,
    rankings: profile.rankings,
    discord_id: profile.discordId,
    discord_avatar_url: profile.discordAvatarUrl,
    skin_render_url: profile.skinRenderUrl
  };
}

function playerForMode(profile, mode) {
  const ranking = profile.rankings[normalize(mode.id)];

  if (!ranking) {
    return null;
  }

  return {
    ...publicProfile(profile),
    tier: ranking.tier,
    pos: ranking.pos,
    peak_tier: ranking.peak_tier,
    peak_pos: ranking.peak_pos,
    retired: ranking.retired
  };
}

function sortModePlayers(players) {
  return players.sort((a, b) => {
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }

    if (a.pos !== b.pos) {
      return a.pos - b.pos;
    }

    if (b.points !== a.points) {
      return b.points - a.points;
    }

    return a.name.localeCompare(b.name);
  });
}

function addModeAlias(entries, sourceKey, aliasKey, name, icon) {
  const source = entries[sourceKey];

  if (source && !entries[aliasKey]) {
    entries[aliasKey] = {
      ...source,
      id: aliasKey,
      name,
      icon
    };
  }
}

async function itstiersModeList(group = 'main') {
  const entries = {};

  for (const mode of config.modes) {
    const key = normalize(mode.id);

    if (!isModeInGroup(key, group)) {
      continue;
    }

    entries[key] = {
      id: key,
      name: mode.name,
      icon: `${key}.svg`,
      discord: process.env.TIERLIST_DISCORD_URL || null,
      show: true,
      kit_image: mode.kitImageUrl || null,
      cooldown_hours: mode.cooldownHours || 0
    };
  }

  const crystal = entries.crystal;
  const netpot = entries.netpot;

  if (resolveModeGroup(group) !== 'subtiers') {
    addModeAlias(entries, 'crystal', 'ltm', 'LTMs', '2v2.svg');
    addModeAlias(entries, 'crystal', 'vanilla', crystal?.name || 'Vanilla', 'vanilla.svg');
    addModeAlias(entries, 'netpot', 'nethop', netpot?.name || 'NethOP', 'nethop.svg');
  }

  return entries;
}

async function itstiersOverall(from = 0, count = 10, group = 'main') {
  const profiles = buildProfiles(await getAllResults(), group).map(publicProfile);
  return profiles.slice(limitValue(from, 0), limitValue(from, 0) + limitValue(count, 10));
}

async function itstiersMode(modeId, from = 0, count = 10, group = 'main') {
  const mode = findMode(modeId);

  if (!mode || !isModeInGroup(mode.id, group)) {
    return null;
  }

  const profiles = buildProfiles(await getAllResults(), group);
  const columns = emptyColumns();
  const offset = limitValue(from, 0);
  const size = limitValue(count, 10);
  const players = sortModePlayers(profiles.map((profile) => playerForMode(profile, mode)).filter(Boolean));

  for (const player of players) {
    columns[player.tier].push(player);
  }

  const page = {};

  for (const tier of Object.keys(columns)) {
    const slice = columns[tier].slice(offset, offset + size);

    if (slice.length > 0) {
      page[tier] = slice;
    }
  }

  return page;
}

async function itstiersProfile(identifier, group = 'main') {
  const normalized = String(identifier || '').toLowerCase().replace(/-/g, '');
  const profiles = buildProfiles(await getAllResults(), group);
  const profile = profiles.find((entry) => {
    return entry.uuid.toLowerCase().replace(/-/g, '') === normalized
      || entry.name.toLowerCase() === normalized
      || entry.discordId === identifier;
  });

  return profile ? publicProfile(profile) : null;
}

module.exports = {
  itstiersMode,
  itstiersModeList,
  itstiersOverall,
  itstiersProfile
};
