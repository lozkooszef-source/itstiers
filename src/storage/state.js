const fs = require('node:fs');
const path = require('node:path');
const { dataPath, config } = require('../config');

let cache;

function defaultModeState() {
  return {
    open: false,
    channelId: null,
    statusMessageId: null,
    waitlist: [],
    queue: [],
    activeTesters: [],
    activeTests: [],
    activeTest: null,
    lastSessionAt: null
  };
}

function defaultState() {
  return {
    requestPanelMessageId: null,
    verifiedAccounts: {},
    waitlists: {},
    results: []
  };
}

function ensureModeState(state, modeId) {
  if (!state.waitlists[modeId]) {
    state.waitlists[modeId] = defaultModeState();
  }

  state.waitlists[modeId].queue ||= [];
  state.waitlists[modeId].waitlist ||= [];
  state.waitlists[modeId].activeTesters ||= [];
  state.waitlists[modeId].activeTests ||= [];
  state.waitlists[modeId].activeTest ||= null;
  state.waitlists[modeId].lastSessionAt ||= null;

  if (state.waitlists[modeId].activeTest) {
    const oldActiveTest = state.waitlists[modeId].activeTest;
    const alreadyMigrated = state.waitlists[modeId].activeTests.some((entry) => {
      return entry.ticketChannelId === oldActiveTest.ticketChannelId || entry.userId === oldActiveTest.userId;
    });

    if (!alreadyMigrated) {
      state.waitlists[modeId].activeTests.push(oldActiveTest);
    }

    state.waitlists[modeId].activeTest = null;
  }

  for (const entry of state.waitlists[modeId].queue) {
    const alreadyWaitlisted = state.waitlists[modeId].waitlist.some((waitlistEntry) => {
      return waitlistEntry.userId === entry.userId;
    });

    if (!alreadyWaitlisted) {
      state.waitlists[modeId].waitlist.push({
        userId: entry.userId,
        username: entry.username,
        server: entry.server,
        modeId: entry.modeId,
        joinedAt: entry.joinedAt || entry.queuedAt || new Date().toISOString()
      });
    }
  }

  return state.waitlists[modeId];
}

function normalizeState(state) {
  state.requestPanelMessageId ||= null;
  state.verifiedAccounts ||= {};
  state.waitlists ||= {};
  state.results ||= [];

  for (const mode of config.modes) {
    ensureModeState(state, mode.id);
  }

  return state;
}

function loadState() {
  if (cache) {
    return cache;
  }

  if (!fs.existsSync(dataPath)) {
    cache = normalizeState(defaultState());
    saveState();
    return cache;
  }

  cache = normalizeState(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
  return cache;
}

function saveState() {
  if (!cache) {
    cache = normalizeState(defaultState());
  }

  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  const tmpPath = `${dataPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, dataPath);
}

module.exports = {
  loadState,
  saveState,
  ensureModeState
};
