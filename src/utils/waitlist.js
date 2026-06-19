const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  ConfigError,
  config,
  guildId,
  optionalDiscordId,
  optionalDiscordIdArray,
  requiredDiscordId
} = require('../config');
const { ensureModeState, loadState, saveState } = require('../storage/state');
const {
  savePlayer,
  saveResult,
  saveWaitlistSnapshot
} = require('../db/repository');
const { channelNameForMode, normalize } = require('./modes');
const { testerRoleIdsForMode } = require('./permissions');
const {
  closedWaitlistPayload,
  openWaitlistPayload,
  ticketOpenedPayload,
  resultPayload
} = require('./embeds');

const WAITLIST_NO_WRITE_PERMISSIONS = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions
].filter(Boolean);

const syncedWaitlistPermissionChannels = new Set();

function nowIso() {
  return new Date().toISOString();
}

function getVerifiedAccount(userId) {
  return loadState().verifiedAccounts[userId] || null;
}

function waitlistCategoryId() {
  return requiredDiscordId(config.waitlistCategoryId, 'waitlistCategoryId');
}

function highTierCategoryId() {
  return requiredDiscordId(config.highTierTickets?.categoryId, 'highTierTickets.categoryId');
}

function testingTicketCategoryId() {
  return optionalDiscordId(config.testingTickets?.categoryId, 'testingTickets.categoryId') || waitlistCategoryId();
}

function setVerifiedAccount(userId, username) {
  const state = loadState();
  state.verifiedAccounts[userId] = {
    username,
    verifiedAt: nowIso()
  };
  saveState();
  savePlayer({
    discordId: userId,
    minecraftUsername: username,
    verifiedAt: state.verifiedAccounts[userId].verifiedAt
  });

  return state.verifiedAccounts[userId];
}

function waitlistEntryFor(modeState, userId) {
  return modeState.waitlist.find((entry) => entry.userId === userId) || null;
}

function activeTesterFor(modeState, userId) {
  return modeState.activeTesters.some((tester) => tester.userId === userId);
}

function activeTestForTester(modeState, testerId) {
  return modeState.activeTests.find((entry) => entry.testerId === testerId) || null;
}

function activeTestForTicket(modeState, ticketChannelId) {
  return modeState.activeTests.find((entry) => entry.ticketChannelId === ticketChannelId) || null;
}

function activeTestForPlayer(modeState, userId) {
  return modeState.activeTests.find((entry) => entry.userId === userId) || null;
}

async function ensureRoleCache(guild) {
  await guild.roles.fetch();
}

async function botMember(guild) {
  return guild.members.me || guild.members.fetchMe();
}

function resolveConfiguredRoles(guild, roleIds, configName) {
  return roleIds.map((roleId) => {
    const role = guild.roles.cache.get(String(roleId));

    if (!role) {
      throw new ConfigError(
        `Invalid ${configName}: role ${roleId} does not exist on this server or the bot cannot see it.`
      );
    }

    return role;
  });
}

async function memberOrId(guild, userId) {
  return guild.members.fetch(userId).catch(() => userId);
}

async function discordAvatarUrlFor(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  return member?.user?.displayAvatarURL({ size: 128 }) || null;
}

function modeFromId(modeId) {
  return config.modes.find((mode) => mode.id === modeId) || { id: modeId, name: modeId };
}

function previousTierFor(state, userId, modeId) {
  const mode = modeFromId(modeId);

  return [...state.results].reverse().find((result) => {
    return result.userId === userId && resultMatchesMode(result, mode);
  })?.tier;
}

function resultMatchesMode(result, mode) {
  const modeId = normalize(mode.id);
  const modeName = normalize(mode.name);

  return normalize(result.modeId) === modeId || normalize(result.modeName) === modeName;
}

function cooldownRemainingForState(state, userId, mode) {
  const latestResult = [...state.results].reverse().find((result) => {
    return result.userId === userId && resultMatchesMode(result, mode);
  });

  if (!latestResult || !mode.cooldownHours) {
    return 0;
  }

  const cooldownUntil =
    new Date(latestResult.closedAt).getTime() + Number(mode.cooldownHours) * 60 * 60 * 1000;

  return Math.max(0, cooldownUntil - Date.now());
}

function cooldownRows(userId) {
  const state = loadState();

  return config.modes.map((mode) => ({
    mode,
    remainingMs: cooldownRemainingForState(state, userId, mode)
  }));
}

function queuePayloadFor(mode, modeState, guild) {
  return modeState.open
    ? openWaitlistPayload(mode, modeState, guild)
    : closedWaitlistPayload(mode, modeState, guild);
}

async function fetchTextChannel(guild, channelId) {
  if (!channelId) {
    return null;
  }

  try {
    const channel = await guild.channels.fetch(channelId);
    return channel?.type === ChannelType.GuildText ? channel : null;
  } catch {
    return null;
  }
}

async function waitlistRoleOverwrites(guild, mode) {
  await ensureRoleCache(guild);
  const bot = await botMember(guild);
  const allowedRoles = new Set([
    ...optionalDiscordIdArray(config.managerRoleIds, 'managerRoleIds'),
    ...testerRoleIdsForMode(mode)
  ]);
  const roles = resolveConfiguredRoles(guild, [...allowedRoles], `${mode.id}.testerRoleIds`);

  return [
    {
      id: guild.roles.everyone,
      deny: [PermissionFlagsBits.ViewChannel, ...WAITLIST_NO_WRITE_PERMISSIONS]
    },
    {
      id: bot,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles
      ]
    },
    ...roles.map((role) => ({
      id: role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
      ],
      deny: WAITLIST_NO_WRITE_PERMISSIONS
    }))
  ];
}

function waitlistViewerPermissions() {
  return {
    ViewChannel: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false,
    ReadMessageHistory: true
  };
}

function waitlistParticipantIds(modeState) {
  const ids = new Set();

  for (const entry of modeState.waitlist || []) {
    ids.add(entry.userId);
  }

  for (const entry of modeState.queue || []) {
    ids.add(entry.userId);
  }

  for (const entry of modeState.activeTests || []) {
    ids.add(entry.userId);
  }

  return [...ids].filter(Boolean);
}

async function syncWaitlistChannelPermissions(guild, channel, mode, modeState) {
  if (syncedWaitlistPermissionChannels.has(channel.id)) {
    return;
  }

  await ensureRoleCache(guild);
  const bot = await botMember(guild);
  const allowedRoles = new Set([
    ...optionalDiscordIdArray(config.managerRoleIds, 'managerRoleIds'),
    ...testerRoleIdsForMode(mode)
  ]);
  const roles = resolveConfiguredRoles(guild, [...allowedRoles], `${mode.id}.testerRoleIds`);

  await channel.permissionOverwrites.edit(guild.roles.everyone, {
    ViewChannel: false,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false
  });

  await channel.permissionOverwrites.edit(bot, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    EmbedLinks: true,
    ManageChannels: true,
    ManageRoles: true
  });

  for (const role of roles) {
    await channel.permissionOverwrites.edit(role, {
      ...waitlistViewerPermissions(),
      EmbedLinks: true
    });
  }

  for (const userId of waitlistParticipantIds(modeState)) {
    await allowUserInChannel(channel, userId);
  }

  syncedWaitlistPermissionChannels.add(channel.id);
}

async function findExistingWaitlistChannel(guild, mode) {
  const name = channelNameForMode(mode);
  const categoryId = waitlistCategoryId();
  const cached = guild.channels.cache.find((channel) => {
    return (
      channel.type === ChannelType.GuildText &&
      channel.name === name &&
      channel.parentId === categoryId
    );
  });

  if (cached) {
    return cached;
  }

  const channels = await guild.channels.fetch();
  return channels.find((channel) => {
    return (
      channel?.type === ChannelType.GuildText &&
      channel.name === name &&
      channel.parentId === categoryId
    );
  });
}

async function ensureWaitlistChannel(guild, mode, state = loadState(), options = {}) {
  const modeState = ensureModeState(state, mode.id);
  const existingById = await fetchTextChannel(guild, modeState.channelId);

  if (existingById) {
    await syncWaitlistChannelPermissions(guild, existingById, mode, modeState);
    return existingById;
  }

  const existingByName = await findExistingWaitlistChannel(guild, mode);

  if (existingByName) {
    modeState.channelId = existingByName.id;
    saveState();
    await syncWaitlistChannelPermissions(guild, existingByName, mode, modeState);
    return existingByName;
  }

  if (options.create === false) {
    return null;
  }

  const channel = await guild.channels.create({
    name: channelNameForMode(mode),
    type: ChannelType.GuildText,
    parent: waitlistCategoryId(),
    topic: `Private waitlist for ${mode.name}.`,
    permissionOverwrites: await waitlistRoleOverwrites(guild, mode),
    reason: `Creating ${mode.name} testing waitlist`
  });

  modeState.channelId = channel.id;
  saveState();

  return channel;
}

async function allowUserInChannel(channel, userId) {
  await channel.permissionOverwrites.edit(userId, waitlistViewerPermissions());
}

async function removeUserFromChannel(channel, userId) {
  try {
    await channel.permissionOverwrites.delete(userId);
  } catch {
    // The overwrite may not exist anymore.
  }
}

function channelSafePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function testingTicketName(activeTest) {
  const emoji = config.testingTickets?.greenCircleEmoji || '\u{1F7E2}';
  const previousTier = activeTest.previousTier && activeTest.previousTier !== 'Unranked'
    ? channelSafePart(activeTest.previousTier)
    : '';
  const parts = [
    channelSafePart(activeTest.username),
    channelSafePart(activeTest.modeId),
    previousTier,
    emoji
  ].filter(Boolean);

  return parts.join('-').slice(0, 100);
}

async function testingTicketOverwrites(guild, activeTest) {
  await ensureRoleCache(guild);
  const bot = await botMember(guild);
  const player = await memberOrId(guild, activeTest.userId);
  const tester = await memberOrId(guild, activeTest.testerId);
  const managerRoleIds = optionalDiscordIdArray(config.managerRoleIds, 'managerRoleIds');
  const managerRoles = resolveConfiguredRoles(guild, managerRoleIds, 'managerRoleIds');

  return [
    {
      id: guild.roles.everyone,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: bot,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles
      ]
    },
    {
      id: player,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: tester,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    ...managerRoles.map((role) => ({
      id: role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
      ]
    }))
  ];
}

async function createTestingTicket(guild, activeTest) {
  const ticket = await guild.channels.create({
    name: testingTicketName(activeTest),
    type: ChannelType.GuildText,
    parent: testingTicketCategoryId(),
    topic: `Testing ticket for ${activeTest.username} (${activeTest.modeName})`,
    permissionOverwrites: await testingTicketOverwrites(guild, activeTest),
    reason: `Testing ticket for ${activeTest.username} ${activeTest.modeName}`
  });

  await ticket.send(ticketOpenedPayload(activeTest));

  return ticket;
}

function isWaitlistStatusMessage(message) {
  if (message.author.id !== message.client.user.id) {
    return false;
  }

  return message.embeds.some((embed) => {
    return embed.title === 'Tester(s) Available!' || embed.title === 'No Testers Online';
  });
}

async function deleteOldWaitlistStatusMessages(channel) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);

  if (!messages) {
    return;
  }

  const deletes = [];

  for (const message of messages.values()) {
    if (isWaitlistStatusMessage(message)) {
      deletes.push(message.delete().catch(() => null));
    }
  }

  await Promise.all(deletes);
}

async function updateWaitlistMessage(guild, mode, options = {}) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);
  const channel = await ensureWaitlistChannel(guild, mode, state, options);

  if (!channel) {
    return null;
  }

  const payload = queuePayloadFor(mode, modeState, guild);

  if (options.forceNew) {
    await deleteOldWaitlistStatusMessages(channel);
    modeState.statusMessageId = null;
    saveState();
  }

  if (!options.forceNew && modeState.statusMessageId) {
    try {
      const message = await channel.messages.fetch(modeState.statusMessageId);
      await message.edit(payload);
      await saveWaitlistSnapshot(mode, modeState);
      return message;
    } catch {
      modeState.statusMessageId = null;
    }
  }

  const message = await channel.send(payload);
  modeState.statusMessageId = message.id;
  saveState();
  await saveWaitlistSnapshot(mode, modeState);

  return message;
}

async function addToWaitlist(guild, userId, mode, server, discordAvatarUrl = null) {
  const state = loadState();
  const verified = state.verifiedAccounts[userId];

  if (!verified) {
    return { status: 'not_verified' };
  }

  const modeState = ensureModeState(state, mode.id);

  if (activeTestForPlayer(modeState, userId)) {
    return { status: 'already_testing' };
  }

  if (waitlistEntryFor(modeState, userId)) {
    return { status: 'already_waitlisted', channelId: modeState.channelId };
  }

  const channel = await ensureWaitlistChannel(guild, mode, state);

  modeState.waitlist.push({
    userId,
    username: verified.username,
    discordAvatarUrl,
    server,
    modeId: mode.id,
    joinedAt: nowIso()
  });
  saveState();

  await allowUserInChannel(channel, userId);
  await savePlayer({
    discordId: userId,
    minecraftUsername: verified.username,
    discordAvatarUrl,
    verifiedAt: verified.verifiedAt
  });
  await updateWaitlistMessage(guild, mode);

  return { status: 'added', channel };
}

async function joinQueue(guild, userId, mode) {
  const state = loadState();
  const verified = state.verifiedAccounts[userId];

  if (!verified) {
    return { status: 'not_verified' };
  }

  const remainingMs = cooldownRemainingForState(state, userId, mode);

  if (remainingMs > 0) {
    return { status: 'cooldown', remainingMs };
  }

  const modeState = ensureModeState(state, mode.id);
  const waitlistEntry = waitlistEntryFor(modeState, userId);

  if (!waitlistEntry) {
    return { status: 'not_waitlisted' };
  }

  if (activeTestForPlayer(modeState, userId)) {
    return { status: 'already_testing' };
  }

  if (modeState.queue.some((entry) => entry.userId === userId)) {
    return { status: 'already_queued' };
  }

  const maxQueueSize = config.waitlist?.maxQueueSize || 20;

  if (modeState.queue.length >= maxQueueSize) {
    return { status: 'full' };
  }

  modeState.queue.push({
    ...waitlistEntry,
    queuedAt: nowIso()
  });
  saveState();

  await updateWaitlistMessage(guild, mode);

  return { status: 'queued', position: modeState.queue.length };
}

async function setWaitlistOpen(guild, mode, open, testerId = null) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);
  modeState.open = open;

  if (open && testerId && !activeTesterFor(modeState, testerId)) {
    modeState.activeTesters.push({
      userId: testerId,
      startedAt: nowIso()
    });
  }

  if (!open) {
    modeState.lastSessionAt = nowIso();
    modeState.activeTesters = [];
  }

  saveState();

  const channel = await ensureWaitlistChannel(guild, mode, state);
  await updateWaitlistMessage(guild, mode, { forceNew: open });

  return { modeState, channel };
}

async function stopTesterAvailability(guild, mode, testerId) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);

  if (!activeTesterFor(modeState, testerId)) {
    return { status: 'not_active' };
  }

  modeState.activeTesters = modeState.activeTesters.filter((tester) => tester.userId !== testerId);

  if (!modeState.activeTesters.length) {
    modeState.open = false;
    modeState.lastSessionAt = nowIso();
  }

  saveState();

  const channel = await ensureWaitlistChannel(guild, mode, state, { create: false });

  if (channel) {
    await updateWaitlistMessage(guild, mode, { create: false, forceNew: true });
  }

  return {
    status: 'stopped',
    channel,
    closed: !modeState.open,
    remainingTesters: modeState.activeTesters.length
  };
}

async function nextInQueue(guild, mode, testerId) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);

  if (!modeState.open) {
    return { status: 'closed' };
  }

  if (!activeTesterFor(modeState, testerId)) {
    return { status: 'not_active_tester' };
  }

  const testerActiveTest = activeTestForTester(modeState, testerId);

  if (testerActiveTest) {
    return { status: 'tester_busy', activeTest: testerActiveTest };
  }

  const entry = modeState.queue[0];

  if (!entry) {
    return { status: 'empty' };
  }

  const activeTest = {
    ...entry,
    testerId,
    discordAvatarUrl: entry.discordAvatarUrl || (await discordAvatarUrlFor(guild, entry.userId)),
    modeName: mode.name,
    previousTier: previousTierFor(state, entry.userId, mode.id) || '',
    startedAt: nowIso()
  };

  const ticket = await createTestingTicket(guild, activeTest);
  activeTest.ticketChannelId = ticket.id;
  modeState.queue.shift();
  modeState.activeTests.push(activeTest);
  saveState();

  await updateWaitlistMessage(guild, mode);

  return { status: 'ok', entry: activeTest, ticket };
}

function tierScore(tier) {
  const match = String(tier).match(/^(High|Low)\s+Tier\s+([1-5])$/i);

  if (!match) {
    return 0;
  }

  const highBonus = match[1].toLowerCase() === 'high' ? 1 : 0;
  const tierNumber = Number(match[2]);

  return (6 - tierNumber) * 2 + highBonus;
}

function shouldCreateHighTierTicket(tier) {
  const settings = config.highTierTickets;

  if (!settings?.enabled || !settings.categoryId) {
    return false;
  }

  return tierScore(tier) >= tierScore(settings.minimumTier || 'High Tier 3');
}

function highTicketChannelName(result) {
  return `high-ticket-${result.username}-${result.modeId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .slice(0, 90);
}

async function createHighTierTicket(guild, result) {
  if (!shouldCreateHighTierTicket(result.tier)) {
    return null;
  }

  await ensureRoleCache(guild);
  const bot = await botMember(guild);
  const player = await memberOrId(guild, result.userId);
  const mode = config.modes.find((candidate) => candidate.id === result.modeId);
  const roleIds = new Set([
    ...optionalDiscordIdArray(config.managerRoleIds, 'managerRoleIds'),
    ...testerRoleIdsForMode(mode)
  ]);
  const roles = resolveConfiguredRoles(guild, [...roleIds], 'highTierTickets.roles');

  const ticket = await guild.channels.create({
    name: highTicketChannelName(result),
    type: ChannelType.GuildText,
    parent: highTierCategoryId(),
    topic: `High tier ticket for ${result.username} (${result.modeName})`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: bot,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: player,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      ...roles.map((role) => ({
        id: role,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.EmbedLinks
        ]
      }))
    ],
    reason: `High tier result: ${result.username} ${result.tier}`
  });

  await ticket.send({
    content: `<@${result.userId}> high-tier ticket created for **${result.modeName}** result: **${result.tier}**.`
  });

  return ticket;
}

async function sendResult(guild, result) {
  const resultsChannelId = requiredDiscordId(config.resultsChannelId, 'resultsChannelId');
  const resultsChannel = await fetchTextChannel(guild, resultsChannelId);

  if (!resultsChannel) {
    return { status: 'missing_results_channel', result };
  }

  const resultsMessage = await resultsChannel.send(resultPayload(result));

  for (const reaction of config.resultReactions || []) {
    try {
      await resultsMessage.react(reaction);
    } catch {
      // Some guilds do not allow specific emoji reactions.
    }
  }

  const ticket = await createHighTierTicket(guild, result);

  return { status: 'ok', result, resultsMessage, ticket };
}

async function closeActiveTest(guild, mode, closingTesterId, tier, options = {}) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);
  const activeTest = options.ticketChannelId
    ? activeTestForTicket(modeState, options.ticketChannelId)
    : activeTestForTester(modeState, closingTesterId);

  if (!activeTest) {
    return { status: 'no_active_test' };
  }

  if (!options.allowManager && activeTest.testerId !== closingTesterId) {
    return { status: 'not_your_test', activeTest };
  }

  const closedAt = nowIso();
  const result = {
    userId: activeTest.userId,
    testerId: activeTest.testerId || closingTesterId,
    username: activeTest.username,
    discordAvatarUrl: activeTest.discordAvatarUrl || (await discordAvatarUrlFor(guild, activeTest.userId)),
    server: activeTest.server,
    modeId: mode.id,
    modeName: mode.name,
    previousTier: activeTest.previousTier || 'Unranked',
    tier,
    requestedAt: activeTest.joinedAt,
    startedAt: activeTest.startedAt,
    closedAt,
    ticketChannelId: activeTest.ticketChannelId || null
  };

  modeState.lastSessionAt = closedAt;
  modeState.activeTests = modeState.activeTests.filter((entry) => {
    if (activeTest.ticketChannelId) {
      return entry.ticketChannelId !== activeTest.ticketChannelId;
    }

    return entry.userId !== activeTest.userId;
  });
  modeState.queue = modeState.queue.filter((entry) => entry.userId !== result.userId);
  modeState.waitlist = modeState.waitlist.filter((entry) => entry.userId !== result.userId);
  state.results.push(result);
  saveState();
  await saveResult(result);

  const waitlistChannel = await ensureWaitlistChannel(guild, mode, state, { create: false });

  if (waitlistChannel) {
    await removeUserFromChannel(waitlistChannel, result.userId);
    await updateWaitlistMessage(guild, mode, { create: false });
  }

  return sendResult(guild, result);
}

async function awardTier(guild, mode, testerId, tier, options = {}) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);
  const userId = options.userId;
  const username = String(options.username || '').trim();

  if (!userId) {
    return { status: 'missing_player' };
  }

  if (!username) {
    return { status: 'missing_username' };
  }

  const closedAt = nowIso();
  const result = {
    userId,
    testerId,
    username,
    discordAvatarUrl: options.discordAvatarUrl || (await discordAvatarUrlFor(guild, userId)),
    server: options.server || config.regions?.[0] || 'EU',
    modeId: mode.id,
    modeName: mode.name,
    previousTier: previousTierFor(state, userId, mode.id) || 'Unranked',
    tier,
    requestedAt: null,
    startedAt: null,
    closedAt,
    ticketChannelId: null
  };

  modeState.lastSessionAt = closedAt;
  modeState.activeTests = modeState.activeTests.filter((entry) => entry.userId !== userId);
  modeState.queue = modeState.queue.filter((entry) => entry.userId !== userId);
  modeState.waitlist = modeState.waitlist.filter((entry) => entry.userId !== userId);
  state.results.push(result);
  saveState();
  await saveResult(result);

  const waitlistChannel = await ensureWaitlistChannel(guild, mode, state, { create: false });

  if (waitlistChannel) {
    await removeUserFromChannel(waitlistChannel, result.userId);
    await updateWaitlistMessage(guild, mode, { create: false });
  }

  return sendResult(guild, result);
}

async function removeFromWaitlist(guild, userId, mode = null) {
  const state = loadState();
  const modes = mode ? [mode] : config.modes;
  const removed = [];

  for (const candidate of modes) {
    const modeState = ensureModeState(state, candidate.id);
    const beforeQueue = modeState.queue.length;
    const beforeWaitlist = modeState.waitlist.length;
    modeState.queue = modeState.queue.filter((entry) => entry.userId !== userId);
    modeState.waitlist = modeState.waitlist.filter((entry) => entry.userId !== userId);

    if (modeState.queue.length !== beforeQueue || modeState.waitlist.length !== beforeWaitlist) {
      removed.push(candidate);
    }
  }

  saveState();

  for (const removedMode of removed) {
    const channel = await ensureWaitlistChannel(guild, removedMode, state, { create: false });

    if (channel) {
      await removeUserFromChannel(channel, userId);
      await updateWaitlistMessage(guild, removedMode, { create: false });
    }
  }

  return removed;
}

function findModeByTicketChannel(channelId) {
  const state = loadState();

  for (const mode of config.modes) {
    const modeState = ensureModeState(state, mode.id);

    if (activeTestForTicket(modeState, channelId)) {
      return mode;
    }
  }

  return null;
}

function findModeByWaitlistChannel(channelId) {
  const state = loadState();

  for (const mode of config.modes) {
    const modeState = ensureModeState(state, mode.id);

    if (modeState.channelId === channelId) {
      return mode;
    }
  }

  return null;
}

function isActiveTesterForMode(userId, mode) {
  const state = loadState();
  const modeState = ensureModeState(state, mode.id);

  return activeTesterFor(modeState, userId);
}

async function refreshAllWaitlistMessages(client) {
  const guild = await client.guilds.fetch(guildId());

  for (const mode of config.modes) {
    const state = loadState();
    const modeState = ensureModeState(state, mode.id);

    if (modeState.channelId && modeState.statusMessageId) {
      await updateWaitlistMessage(guild, mode, { create: false });
    }
  }
}

module.exports = {
  addToWaitlist,
  awardTier,
  closeActiveTest,
  cooldownRows,
  findModeByTicketChannel,
  findModeByWaitlistChannel,
  getVerifiedAccount,
  isActiveTesterForMode,
  joinQueue,
  nextInQueue,
  refreshAllWaitlistMessages,
  removeFromWaitlist,
  setVerifiedAccount,
  setWaitlistOpen,
  stopTesterAvailability,
  updateWaitlistMessage
};
