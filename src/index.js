const { Client, Events, GatewayIntentBits } = require('discord.js');
const { config, token } = require('./config');
const handleInteraction = require('./interactions');
const { startApiServer } = require('./api/server');
const { closePool } = require('./db/pool');
const { refreshAllWaitlistMessages } = require('./utils/waitlist');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let apiServer = null;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  apiServer = startApiServer();

  const refreshSeconds = config.waitlist?.queueRefreshSeconds || 10;

  setInterval(() => {
    refreshAllWaitlistMessages(client).catch((error) => {
      console.error('Waitlist refresh failed:', error);
    });
  }, refreshSeconds * 1000);
});

client.on(Events.InteractionCreate, handleInteraction);

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

async function shutdown() {
  if (apiServer) {
    apiServer.close();
  }

  await closePool();
  client.destroy();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

client.login(token());
