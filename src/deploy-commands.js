const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { clientId, config, guildId, token } = require('./config');
const { modeChoices } = require('./utils/modes');

function addModeOption(command, required = true) {
  return command.addStringOption((option) =>
    option
      .setName('mode')
      .setDescription('Testing mode')
      .setRequired(required)
      .addChoices(...modeChoices())
  );
}

function tierChoices() {
  return (config.tiers || []).slice(0, 25).map((tier) => ({
    name: tier,
    value: tier
  }));
}

function addTierOption(command) {
  return command.addStringOption((option) =>
    option
      .setName('tier')
      .setDescription('Tier earned by the player')
      .setRequired(true)
      .addChoices(...tierChoices())
  );
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Send or update the request-test waitlist panel.'),

  addModeOption(
    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Open testers for a waitlist mode.')
  ),

  addModeOption(
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Close testers for a waitlist mode.')
  ),

  addModeOption(
    new SlashCommandBuilder()
      .setName('next')
      .setDescription('Pull the next player from a mode waitlist.')
  ),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the active test and post the result.')
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Tier earned by the player')
        .setRequired(true)
        .addChoices(...tierChoices())
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Testing mode. Optional inside a testing ticket.')
        .setRequired(false)
        .addChoices(...modeChoices())
    ),

  addTierOption(
    addModeOption(
      new SlashCommandBuilder()
        .setName('award-tier')
        .setDescription('Award a tier and post the result.')
    )
  )
    .addUserOption((option) =>
      option
        .setName('player')
        .setDescription('Player to award when using the command outside a testing ticket')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Minecraft username, needed if the selected player is not verified')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('server')
        .setDescription('Server or region for the result')
        .setRequired(false)
    ),

  addModeOption(
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Leave a waitlist. Leave mode empty to leave all waitlists.'),
    false
  )
].map((command) => command.toJSON());

async function main() {
  const rest = new REST({ version: '10' }).setToken(token());

  console.log(`Deploying ${commands.length} guild commands...`);
  await rest.put(Routes.applicationGuildCommands(clientId(), guildId()), {
    body: commands
  });
  console.log('Commands deployed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  commands
};
