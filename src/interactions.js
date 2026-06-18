const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { ConfigError, config, optionalDiscordId } = require('./config');
const { ensureModeState, loadState, saveState } = require('./storage/state');
const { canManageBot, canTestMode } = require('./utils/permissions');
const { getModeById, resolveMode } = require('./utils/modes');
const {
  BUTTON_ENTER_WAITLIST,
  BUTTON_JOIN_QUEUE,
  BUTTON_VERIFY,
  BUTTON_VIEW_COOLDOWN,
  MODAL_ENTER_WAITLIST,
  MODAL_VERIFY,
  cooldownPayload,
  requestPanelPayload
} = require('./utils/embeds');
const {
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
  removeFromWaitlist,
  setVerifiedAccount,
  setWaitlistOpen,
  stopTesterAvailability
} = require('./utils/waitlist');

function ephemeral(contentOrPayload) {
  if (typeof contentOrPayload === 'string') {
    return { content: contentOrPayload, ephemeral: true };
  }

  return { ...contentOrPayload, ephemeral: true };
}

async function replyError(interaction, message) {
  const payload = ephemeral(message);

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function modeFromOption(interaction) {
  return getModeById(interaction.options.getString('mode'));
}

function usernameIsValid(username) {
  return /^[A-Za-z0-9_]{3,16}$/.test(username);
}

async function setupPanel(interaction) {
  if (!canManageBot(interaction.member)) {
    return replyError(interaction, 'You do not have permission to set up the waitlist panel.');
  }

  const channelId = optionalDiscordId(config.requestChannelId, 'requestChannelId') || interaction.channelId;
  const channel = await interaction.guild.channels.fetch(channelId);

  if (!channel?.isTextBased()) {
    return replyError(interaction, 'Configured requestChannelId is not a text channel.');
  }

  const state = loadState();
  let message = null;

  if (state.requestPanelMessageId) {
    try {
      message = await channel.messages.fetch(state.requestPanelMessageId);
      await message.edit(requestPanelPayload());
    } catch {
      message = null;
    }
  }

  if (!message) {
    message = await channel.send(requestPanelPayload());
  }

  state.requestPanelMessageId = message.id;
  saveState();

  return interaction.reply(ephemeral(`Waitlist panel is ready in ${channel}.`));
}

async function startWaitlist(interaction) {
  const mode = modeFromOption(interaction);

  if (!mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  if (!canTestMode(interaction.member, mode)) {
    return replyError(interaction, `You are not a tester for ${mode.name}.`);
  }

  await interaction.deferReply({ ephemeral: true });
  const { channel } = await setWaitlistOpen(interaction.guild, mode, true, interaction.user.id);

  return interaction.editReply(`Opened **${mode.name}** waitlist in ${channel}.`);
}

async function stopWaitlist(interaction) {
  const mode = modeFromOption(interaction);
  const channelMode = findModeByWaitlistChannel(interaction.channelId);

  if (!mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  if (channelMode && channelMode.id !== mode.id) {
    return replyError(
      interaction,
      `This channel is for **${channelMode.name}**, but you selected **${mode.name}**. Use /stop mode:${channelMode.id}.`
    );
  }

  if (!canTestMode(interaction.member, mode)) {
    return replyError(interaction, `You are not a tester for ${mode.name}.`);
  }

  if (!isActiveTesterForMode(interaction.user.id, mode)) {
    return replyError(interaction, `You are not an active tester for ${mode.name}.`);
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await stopTesterAvailability(interaction.guild, mode, interaction.user.id);

  if (result.status === 'not_active') {
    return interaction.editReply(`You are not an active tester for **${mode.name}**.`);
  }

  if (result.closed) {
    return interaction.editReply(`Closed testers for **${mode.name}**. Status updated in ${result.channel}.`);
  }

  return interaction.editReply(
    `Removed you from active testers for **${mode.name}**. ${result.remainingTesters} tester(s) still active.`
  );
}

async function pullNext(interaction) {
  const mode = modeFromOption(interaction);

  if (!mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  if (!canTestMode(interaction.member, mode)) {
    return replyError(interaction, `You are not a tester for ${mode.name}.`);
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await nextInQueue(interaction.guild, mode, interaction.user.id);

  if (result.status === 'closed') {
    return interaction.editReply(`The **${mode.name}** waitlist is closed. Use /start first.`);
  }

  if (result.status === 'tester_busy') {
    return interaction.editReply(
      `You already have an active **${mode.name}** ticket: <#${result.activeTest.ticketChannelId}>. Use /close there first.`
    );
  }

  if (result.status === 'not_active_tester') {
    return interaction.editReply(`You are not an active tester for **${mode.name}**. Use /start first.`);
  }

  if (result.status === 'empty') {
    return interaction.editReply(`The **${mode.name}** queue is empty.`);
  }

  return interaction.editReply(
    `Opened testing ticket ${result.ticket} for <@${result.entry.userId}>.`
  );
}

async function closeTest(interaction, options = {}) {
  const requestedMode = modeFromOption(interaction);
  const ticketMode = findModeByTicketChannel(interaction.channelId);
  const mode = requestedMode || ticketMode;
  const tier = interaction.options.getString('tier');
  const action = options.action || 'Closed';

  if (!mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  if (!canTestMode(interaction.member, mode)) {
    return replyError(interaction, `You are not a tester for ${mode.name}.`);
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await closeActiveTest(interaction.guild, mode, interaction.user.id, tier, {
    allowManager: canManageBot(interaction.member),
    ticketChannelId: ticketMode ? interaction.channelId : null
  });

  if (result.status === 'no_active_test') {
    return interaction.editReply(`There is no active **${mode.name}** test. Use /next first.`);
  }

  if (result.status === 'not_your_test') {
    return interaction.editReply(`Only <@${result.activeTest.testerId}> can close this **${mode.name}** ticket.`);
  }

  if (result.status === 'missing_results_channel') {
    return interaction.editReply(
      `Saved the result, but I could not find resultsChannelId. Result: ${result.result.username} - ${result.result.tier}.`
    );
  }

  const ticketLine = result.ticket ? ` High-tier ticket: ${result.ticket}.` : '';
  await interaction.editReply(
    `${action} **${mode.name}** test for <@${result.result.userId}> as **${tier}**.${ticketLine}`
  );

  if (config.testingTickets?.deleteOnClose !== false && result.result.ticketChannelId) {
    const ticketChannel = await interaction.guild.channels.fetch(result.result.ticketChannelId).catch(() => null);

    if (ticketChannel?.deletable) {
      await ticketChannel.delete(`Testing ticket closed: ${result.result.username} ${tier}`);
    }
  }

  return null;
}

async function awardTierCommand(interaction) {
  const mode = modeFromOption(interaction);
  const tier = interaction.options.getString('tier');
  const target = interaction.options.getUser('player');
  const usernameInput = interaction.options.getString('username')?.trim() || '';
  const server = interaction.options.getString('server')?.trim() || config.regions?.[0] || 'EU';

  if (!mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  if (!canTestMode(interaction.member, mode)) {
    return replyError(interaction, `You are not a tester for ${mode.name}.`);
  }

  if (!target) {
    return closeTest(interaction, { action: 'Awarded' });
  }

  if (target.bot) {
    return replyError(interaction, 'You cannot award a tier to a bot account.');
  }

  if (usernameInput && !usernameIsValid(usernameInput)) {
    return replyError(
      interaction,
      'Minecraft username must be 3-16 characters and can only contain letters, numbers and underscores.'
    );
  }

  if (!server || server.length > 32) {
    return replyError(interaction, 'Server/region must be 2-32 characters.');
  }

  const verifiedAccount = getVerifiedAccount(target.id);
  const username = usernameInput || verifiedAccount?.username;

  if (!username) {
    return replyError(interaction, 'That player is not verified. Add username:<minecraft username> to award manually.');
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await awardTier(interaction.guild, mode, interaction.user.id, tier, {
    userId: target.id,
    username,
    server,
    discordAvatarUrl: target.displayAvatarURL({ size: 128 })
  });

  if (result.status === 'missing_results_channel') {
    return interaction.editReply(
      `Saved the result, but I could not find resultsChannelId. Result: ${result.result.username} - ${result.result.tier}.`
    );
  }

  if (result.status === 'missing_player') {
    return interaction.editReply('Select a player when awarding outside a testing ticket.');
  }

  if (result.status === 'missing_username') {
    return interaction.editReply('That player is not verified. Add username:<minecraft username> to award manually.');
  }

  const ticketLine = result.ticket ? ` High-tier ticket: ${result.ticket}.` : '';
  return interaction.editReply(
    `Awarded **${mode.name}** tier to <@${result.result.userId}> as **${tier}**.${ticketLine}`
  );
}

async function leaveWaitlist(interaction) {
  const modeId = interaction.options.getString('mode');
  const mode = modeId ? getModeById(modeId) : null;

  if (modeId && !mode) {
    return replyError(interaction, 'Unknown mode.');
  }

  await interaction.deferReply({ ephemeral: true });
  const removed = await removeFromWaitlist(interaction.guild, interaction.user.id, mode);

  if (!removed.length) {
    return interaction.editReply('You were not in that waitlist.');
  }

  return interaction.editReply(`Removed you from: ${removed.map((entry) => `**${entry.name}**`).join(', ')}.`);
}

async function handleCommand(interaction) {
  if (!interaction.guild) {
    return replyError(interaction, 'This bot only works inside a server.');
  }

  switch (interaction.commandName) {
    case 'setup':
      return setupPanel(interaction);
    case 'start':
      return startWaitlist(interaction);
    case 'stop':
      return stopWaitlist(interaction);
    case 'next':
      return pullNext(interaction);
    case 'close':
      return closeTest(interaction);
    case 'award-tier':
      return awardTierCommand(interaction);
    case 'leave':
      return leaveWaitlist(interaction);
    default:
      return replyError(interaction, 'Unknown command.');
  }
}

function buildVerifyModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_VERIFY)
    .setTitle('Verify Account')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('username')
          .setLabel('Minecraft username')
          .setPlaceholder('Example: lozkoo')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(16)
          .setRequired(true)
      )
    );
}

function buildEnterWaitlistModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ENTER_WAITLIST)
    .setTitle('Enter Waitlist')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mode')
          .setLabel('Mode')
          .setPlaceholder('Mace, Sword, Crystal...')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('server')
          .setLabel('Server / region')
          .setPlaceholder((config.regions || []).join(', ') || 'EU')
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(32)
          .setRequired(true)
      )
    );
}

async function handleButton(interaction) {
  if (interaction.customId === BUTTON_VERIFY) {
    return interaction.showModal(buildVerifyModal());
  }

  if (interaction.customId === BUTTON_ENTER_WAITLIST) {
    if (!getVerifiedAccount(interaction.user.id)) {
      return interaction.reply(ephemeral('You must verify your account before joining a waitlist.'));
    }

    return interaction.showModal(buildEnterWaitlistModal());
  }

  if (interaction.customId === BUTTON_VIEW_COOLDOWN) {
    return interaction.reply(cooldownPayload(cooldownRows(interaction.user.id)));
  }

  if (interaction.customId.startsWith(`${BUTTON_JOIN_QUEUE}:`)) {
    const modeId = interaction.customId.split(':').at(-1);
    const mode = getModeById(modeId);

    if (!mode) {
      return interaction.reply(ephemeral('Unknown mode.'));
    }

    await interaction.deferReply({ ephemeral: true });
    const result = await joinQueue(interaction.guild, interaction.user.id, mode);

    switch (result.status) {
      case 'not_verified':
        return interaction.editReply('You must verify your account before joining a queue.');
      case 'cooldown':
        return interaction.editReply(`You are still on cooldown for **${mode.name}**.`);
      case 'not_waitlisted':
        return interaction.editReply('You must enter this waitlist from the request panel first.');
      case 'already_testing':
        return interaction.editReply(`You are already being tested for **${mode.name}**.`);
      case 'already_queued':
        return interaction.editReply(`You are already in the **${mode.name}** queue.`);
      case 'full':
        return interaction.editReply(`The **${mode.name}** queue is full right now.`);
      case 'queued':
        return interaction.editReply(`You joined the **${mode.name}** queue. Position: **${result.position}**.`);
      default:
        return interaction.editReply('Something went wrong while joining the queue.');
    }
  }

  return replyError(interaction, 'Unknown button.');
}

async function handleVerifyModal(interaction) {
  const username = interaction.fields.getTextInputValue('username').trim();

  if (!usernameIsValid(username)) {
    return interaction.reply(
      ephemeral('Minecraft username must be 3-16 characters and can only contain letters, numbers and underscores.')
    );
  }

  setVerifiedAccount(interaction.user.id, username);

  return interaction.reply(ephemeral(`Verified as **${username}**. You can now enter the waitlist.`));
}

async function handleEnterWaitlistModal(interaction) {
  const modeInput = interaction.fields.getTextInputValue('mode').trim();
  const server = interaction.fields.getTextInputValue('server').trim();
  const mode = resolveMode(modeInput);

  if (!mode) {
    return interaction.reply(
      ephemeral(`Unknown mode. Available modes: ${config.modes.map((entry) => entry.name).join(', ')}.`)
    );
  }

  if (!server || server.length > 32) {
    return interaction.reply(ephemeral('Server/region must be 2-32 characters.'));
  }

  await interaction.deferReply({ ephemeral: true });
  const result = await addToWaitlist(
    interaction.guild,
    interaction.user.id,
    mode,
    server,
    interaction.user.displayAvatarURL({ size: 128 })
  );

  const modeState = ensureModeState(loadState(), mode.id);

  switch (result.status) {
    case 'not_verified':
      return interaction.editReply('You must verify your account before joining a waitlist.');
    case 'cooldown':
      return interaction.editReply(`You are still on cooldown for **${mode.name}**.`);
    case 'already_testing':
      return interaction.editReply(`You are already being tested for **${mode.name}**.`);
    case 'already_waitlisted':
      return interaction.editReply(`You are already in the **${mode.name}** waitlist: <#${modeState.channelId}>.`);
    case 'added':
      return interaction.editReply(
        `Added you to **${mode.name}** waitlist: ${result.channel}. Use **Join Queue** there when testers are available.`
      );
    default:
      return interaction.editReply('Something went wrong while joining the waitlist.');
  }
}

async function handleModal(interaction) {
  if (interaction.customId === MODAL_VERIFY) {
    return handleVerifyModal(interaction);
  }

  if (interaction.customId === MODAL_ENTER_WAITLIST) {
    return handleEnterWaitlistModal(interaction);
  }

  return replyError(interaction, 'Unknown modal.');
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      return await handleCommand(interaction);
    }

    if (interaction.isButton()) {
      return await handleButton(interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleModal(interaction);
    }
  } catch (error) {
    console.error(error);
    if (error instanceof ConfigError || error.name === 'ConfigError') {
      return replyError(interaction, error.message);
    }

    return replyError(interaction, 'Unexpected bot error. Check the console logs.');
  }

  return null;
}

module.exports = handleInteraction;
