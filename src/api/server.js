const fs = require('node:fs');
const path = require('node:path');
const cors = require('cors');
const express = require('express');
const { config, rootDir } = require('../config');
const { hasDatabase } = require('../db/pool');
const {
  getPlayer,
  leaderboard,
  listResults,
  listWaitlists
} = require('../db/repository');
const {
  mctiersMode,
  mctiersModeList,
  mctiersOverall,
  mctiersProfile
} = require('./mctiersCompat');

function corsOptions() {
  const origin = process.env.CORS_ORIGIN || '*';

  if (origin === '*') {
    return { origin: true };
  }

  return {
    origin: origin.split(',').map((entry) => entry.trim()).filter(Boolean)
  };
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function resolveStaticSiteDir() {
  const staticSiteDir = process.env.STATIC_SITE_DIR;

  if (!staticSiteDir) {
    return null;
  }

  const resolved = path.isAbsolute(staticSiteDir)
    ? staticSiteDir
    : path.resolve(rootDir, staticSiteDir);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.warn(`STATIC_SITE_DIR does not exist or is not a directory: ${resolved}`);
    return null;
  }

  return resolved;
}

function installStaticSite(app) {
  const staticSiteDir = resolveStaticSiteDir();

  if (!staticSiteDir) {
    return;
  }

  const staticMiddleware = express.static(staticSiteDir);
  const indexPath = path.join(staticSiteDir, 'index.html');

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    staticMiddleware(req, res, next);
  });

  if (fs.existsSync(indexPath)) {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }

      res.sendFile(indexPath);
    });
  }

  console.log(`Serving website from ${staticSiteDir}`);
}

async function resolveMinecraftUuid(identifier, signal) {
  const value = String(identifier || '').trim();
  const compactUuid = value.replace(/-/g, '');

  if (/^[0-9a-f]{32}$/i.test(compactUuid)) {
    return compactUuid;
  }

  const response = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(value)}`,
    { signal }
  );

  if (!response.ok) {
    return value;
  }

  const profile = await response.json();
  return profile.id || value;
}

function createApiServer() {
  const app = express();

  app.use(cors(corsOptions()));
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      database: hasDatabase(),
      modes: config.modes.length
    });
  });

  app.get('/api/modes', (req, res) => {
    res.json({
      modes: config.modes.map((mode) => ({
        id: mode.id,
        name: mode.name,
        cooldownHours: mode.cooldownHours || 0
      }))
    });
  });

  app.get('/api/v2/mode/list', asyncRoute(async (req, res) => {
    res.json(await mctiersModeList());
  }));

  app.get('/api/v2/pvpclub/:uuid', asyncRoute(async (req, res) => {
    const token = process.env.PVPCLUB_TOKEN;

    if (!token) {
      res.status(404).json({ error: 'pvpclub_disabled' });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const uuid = await resolveMinecraftUuid(req.params.uuid, controller.signal);
      const upstream = await fetch(
        `https://api.mcpvp.club/v1/customname?uuid=${encodeURIComponent(uuid)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          signal: controller.signal
        }
      );
      const body = await upstream.text();

      res
        .status(upstream.status)
        .type(upstream.headers.get('content-type') || 'application/json')
        .send(body);
    } finally {
      clearTimeout(timeout);
    }
  }));

  app.get('/api/v2/mode/overall', asyncRoute(async (req, res) => {
    res.json(await mctiersOverall(req.query.from, req.query.count));
  }));

  app.get('/api/v2/mode/:mode', asyncRoute(async (req, res) => {
    const mode = await mctiersMode(req.params.mode, req.query.from, req.query.count);

    if (!mode) {
      res.status(404).json({ error: 'mode_not_found' });
      return;
    }

    res.json(mode);
  }));

  app.get('/api/v2/profile/by-name/:name', asyncRoute(async (req, res) => {
    const profile = await mctiersProfile(req.params.name);

    if (!profile) {
      res.status(404).json({ error: 'player_not_found' });
      return;
    }

    res.json(profile);
  }));

  app.get('/api/v2/profile/:identifier', asyncRoute(async (req, res) => {
    const profile = await mctiersProfile(req.params.identifier);

    if (!profile) {
      res.status(404).json({ error: 'player_not_found' });
      return;
    }

    res.json(profile);
  }));

  app.get('/api/results', asyncRoute(async (req, res) => {
    const results = await listResults({
      username: req.query.username,
      mode: req.query.mode,
      discordId: req.query.discordId,
      limit: req.query.limit
    });

    res.json({ results });
  }));

  app.get('/api/players/:identifier', asyncRoute(async (req, res) => {
    const player = await getPlayer(req.params.identifier);

    if (!player) {
      res.status(404).json({ error: 'player_not_found' });
      return;
    }

    res.json({ player });
  }));

  app.get('/api/waitlists', asyncRoute(async (req, res) => {
    const waitlists = await listWaitlists();
    res.json({ waitlists });
  }));

  app.get('/api/waitlists/:mode', asyncRoute(async (req, res) => {
    const waitlists = await listWaitlists();
    const waitlist = waitlists.find((entry) => {
      return entry.modeId.toLowerCase() === req.params.mode.toLowerCase()
        || entry.modeName.toLowerCase() === req.params.mode.toLowerCase();
    });

    if (!waitlist) {
      res.status(404).json({ error: 'waitlist_not_found' });
      return;
    }

    res.json({ waitlist });
  }));

  app.get('/api/leaderboard', asyncRoute(async (req, res) => {
    const entries = await leaderboard({
      mode: req.query.mode,
      limit: req.query.limit
    });

    res.json({ entries });
  }));

  installStaticSite(app);

  app.use((error, req, res, next) => {
    console.error('API error:', error);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

function startApiServer() {
  if (process.env.API_ENABLED === 'false') {
    return null;
  }

  const port = Number.parseInt(process.env.API_PORT || '3000', 10);
  const app = createApiServer();
  const server = app.listen(port, () => {
    console.log(`Website API listening on http://localhost:${port}`);
  });

  return server;
}

module.exports = {
  createApiServer,
  startApiServer
};
