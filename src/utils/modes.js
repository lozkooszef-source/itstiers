const { config } = require('../config');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getModeById(modeId) {
  return config.modes.find((mode) => mode.id === modeId);
}

function resolveMode(input) {
  const normalized = normalize(input);

  return config.modes.find((mode) => {
    return normalize(mode.id) === normalized || normalize(mode.name) === normalized;
  });
}

function modeChoices() {
  return config.modes.slice(0, 25).map((mode) => ({
    name: mode.name,
    value: mode.id
  }));
}

function channelNameForMode(mode) {
  return `waitlist-${mode.id}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

module.exports = {
  getModeById,
  resolveMode,
  modeChoices,
  channelNameForMode,
  normalize
};
