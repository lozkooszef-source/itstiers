const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { config } = require('../config');
const { color, discordTimestamp, formatDuration, minecraftAvatarUrl } = require('./format');

const BUTTON_VERIFY = 'mctiers:verify';
const BUTTON_ENTER_WAITLIST = 'mctiers:enter_waitlist';
const BUTTON_VIEW_COOLDOWN = 'mctiers:view_cooldown';
const BUTTON_JOIN_QUEUE = 'mctiers:join_queue';
const MODAL_VERIFY = 'mctiers:modal_verify';
const MODAL_ENTER_WAITLIST = 'mctiers:modal_enter_waitlist';

function guildBrand(guild) {
  if (!guild) {
    return {
      name: config.brand?.name || 'MCTIERS',
      iconURL: config.brand?.iconUrl || undefined
    };
  }

  return {
    name: guild.name,
    iconURL: guild.iconURL({ size: 128 }) || undefined
  };
}

function requestPanelPayload() {
  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.accentColor, 0x5865f2))
    .setAuthor({
      name: config.brand?.name || 'MCTIERS',
      iconURL: config.brand?.iconUrl || undefined
    })
    .setTitle('\u{1F4DD} Evaluation Testing Waitlist')
    .setDescription(
      [
        'Upon applying, you will be added to a waitlist channel.',
        'Here you will be pinged when a tester of your region is available.',
        'If you are HT3 or higher, a high ticket will be created',
        '',
        '\u2022 Region should be the region of the server you wish to test on',
        '',
        '\u2022 Username should be the name of the account you will be testing on',
        '',
        '\u{1F6D1} **Failure to provide authentic information will result in a denied test.**'
      ].join('\n')
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_VERIFY)
      .setLabel('Verify Account')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BUTTON_ENTER_WAITLIST)
      .setLabel('Enter Waitlist')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(BUTTON_VIEW_COOLDOWN)
      .setLabel('View Cooldown')
      .setStyle(ButtonStyle.Primary)
  );

  return {
    embeds: [embed],
    components: [buttons]
  };
}

function activeTesterLines(mode, modeState) {
  const activeTesters = modeState.activeTesters || [];

  if (!activeTesters.length) {
    return ['No active testers.'];
  }

  return activeTesters.map((tester, index) => {
    return `${index + 1}. <@${tester.userId}> (${mode.name})`;
  });
}

function openWaitlistPayload(mode, modeState) {
  const maxQueueSize = config.waitlist?.maxQueueSize || 20;
  const refreshSeconds = config.waitlist?.queueRefreshSeconds || 10;
  const queue = modeState.queue || [];
  const queueLines = queue.slice(0, maxQueueSize).map((entry, index) => {
    return `${index + 1}. <@${entry.userId}>`;
  });

  if (!queueLines.length) {
    queueLines.push('No players in queue.');
  }

  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.accentColor, 0x5865f2))
    .setTitle('Tester(s) Available!')
    .setDescription(
      [
        `The queue updates every ${refreshSeconds} seconds.`,
        `Use \`/leave mode:${mode.id}\` if you wish to be removed from the waitlist or queue.`,
        '',
        `**Queue (${Math.min(queue.length, maxQueueSize)}/${maxQueueSize}):**`,
        queueLines.join('\n'),
        '',
        '**Active Testers:**',
        activeTesterLines(mode, modeState).join('\n')
      ].join('\n')
    );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_JOIN_QUEUE}:${mode.id}`)
      .setLabel('Join Queue')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(queue.length >= maxQueueSize)
  );

  return {
    content: '@here',
    embeds: [embed],
    components: [buttons],
    allowedMentions: { parse: ['everyone'] }
  };
}

function closedWaitlistPayload(mode, modeState, guild = null) {
  const brand = guildBrand(guild);
  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.closedColor, 0xed4245))
    .setAuthor({
      name: brand.name,
      iconURL: brand.iconURL
    })
    .setTitle('No Testers Online')
    .setDescription(
      [
        'No testers for your region are available at this time.',
        'You will be pinged when a tester is available.',
        'Check back later!',
        '',
        `Last testing session: ${discordTimestamp(modeState.lastSessionAt)}`
      ].join('\n')
    )
    .setFooter({ text: brand.name, iconURL: brand.iconURL })
    .setTimestamp(new Date());

  return { content: '', embeds: [embed], components: [] };
}

function cooldownPayload(rows) {
  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.accentColor, 0x5865f2))
    .setTitle('Testing Cooldowns')
    .setDescription(
      rows
        .map((row) => `**${row.mode.name}:** ${row.remainingMs > 0 ? formatDuration(row.remainingMs) : 'Ready'}`)
        .join('\n')
    )
    .setTimestamp(new Date());

  return { embeds: [embed], ephemeral: true };
}

function ticketOpenedPayload(activeTest) {
  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.accentColor, 0x5865f2))
    .setTitle('Testing Ticket')
    .setDescription(
      [
        `Tester: <@${activeTest.testerId}>`,
        `Player: <@${activeTest.userId}>`,
        `Username: **${activeTest.username}**`,
        `Mode: **${activeTest.modeName}**`,
        `Region: **${activeTest.server}**`,
        `Current Rank: **${activeTest.previousTier || 'Unranked'}**`,
        '',
        'Use `/award-tier mode:<mode> tier:<tier>` or `/close tier:<tier>` in this ticket when the test is finished.'
      ].join('\n')
    )
    .setTimestamp(new Date());

  return {
    content: `<@${activeTest.userId}> <@${activeTest.testerId}>`,
    embeds: [embed]
  };
}

function resultPayload(result) {
  const embed = new EmbedBuilder()
    .setColor(color(config.brand?.resultsColor, 0xff0000))
    .setAuthor({
      name: `${result.username}'s Test Results \u{1F3C6}`,
      iconURL: result.discordAvatarUrl || undefined
    })
    .setThumbnail(minecraftAvatarUrl(result.username))
    .addFields(
      { name: 'Tester:', value: `<@${result.testerId}>`, inline: false },
      { name: 'Region:', value: result.server, inline: false },
      { name: 'Username:', value: result.username, inline: false },
      { name: 'Mode:', value: result.modeName, inline: false },
      { name: 'Previous Rank:', value: result.previousTier || 'Unranked', inline: false },
      { name: 'Rank Earned:', value: result.tier, inline: false }
    )
    .setTimestamp(new Date(result.closedAt));

  return {
    content: `<@${result.userId}>`,
    embeds: [embed]
  };
}

module.exports = {
  BUTTON_VERIFY,
  BUTTON_ENTER_WAITLIST,
  BUTTON_VIEW_COOLDOWN,
  BUTTON_JOIN_QUEUE,
  MODAL_VERIFY,
  MODAL_ENTER_WAITLIST,
  requestPanelPayload,
  openWaitlistPayload,
  closedWaitlistPayload,
  cooldownPayload,
  ticketOpenedPayload,
  resultPayload
};
