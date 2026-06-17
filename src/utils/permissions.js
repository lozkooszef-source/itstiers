const { PermissionFlagsBits } = require('discord.js');
const { config, optionalDiscordIdArray } = require('../config');

function hasAnyRole(member, roleIds) {
  if (!member || !roleIds?.length) {
    return false;
  }

  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function isAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
      member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function canManageBot(member) {
  return isAdmin(member) || hasAnyRole(member, config.managerRoleIds);
}

function testerRoleIdsForMode(mode) {
  return [
    ...new Set([
      ...optionalDiscordIdArray(config.testerRoleIds, 'testerRoleIds'),
      ...optionalDiscordIdArray(mode.testerRoleIds, `modes.${mode.id}.testerRoleIds`)
    ])
  ];
}

function canTestMode(member, mode) {
  return canManageBot(member) || hasAnyRole(member, testerRoleIdsForMode(mode));
}

module.exports = {
  canManageBot,
  canTestMode,
  testerRoleIdsForMode
};
