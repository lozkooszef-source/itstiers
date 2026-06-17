function color(value, fallback) {
  if (!value) {
    return fallback;
  }

  if (typeof value === 'number') {
    return value;
  }

  return Number.parseInt(String(value).replace('#', ''), 16);
}

function discordTimestamp(isoDate, style = 'f') {
  if (!isoDate) {
    return 'Never';
  }

  return `<t:${Math.floor(new Date(isoDate).getTime() / 1000)}:${style}>`;
}

function formatDuration(ms) {
  if (ms <= 0) {
    return 'Ready';
  }

  const totalMinutes = Math.ceil(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes || !parts.length) {
    parts.push(`${minutes}m`);
  }

  return parts.join(' ');
}

function minecraftAvatarUrl(username) {
  return `https://render.crafty.gg/3d/bust/${encodeURIComponent(username)}`;
}

module.exports = {
  color,
  discordTimestamp,
  formatDuration,
  minecraftAvatarUrl
};
