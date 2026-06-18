# MCTiers-style Discord Bot

This bot creates an MCTiers-style testing flow with a `request-test` panel, username verification, per-mode waitlists, a `Join Queue` button, private testing tickets, cooldowns and result embeds in `results`.

## Setup

1. Install Node.js 20+.
2. Run:

```bash
npm install
```

3. Copy the config files:

```bash
copy .env.example .env
copy config.example.json config.json
```

4. Fill `.env`:

```env
DISCORD_TOKEN=bot_token
CLIENT_ID=bot_application_client_id
GUILD_ID=server_id
```

5. Fill `config.json`:

- `requestChannelId` - the `request-test` channel ID,
- `resultsChannelId` - the `results` channel ID,
- `waitlistCategoryId` - the `waitlist` category ID,
- `testingTickets.categoryId` - optional ticket category ID. Leave empty to use the waitlist category,
- `managerRoleIds` - roles allowed to use `/setup`, `/start`, `/stop`,
- `testerRoleIds` or `modes[].testerRoleIds` - tester roles.

Every Discord ID must be the real numeric ID copied from Discord developer mode. Do not leave values like `WAITLIST_CATEGORY_ID` in `config.json`.

6. Deploy slash commands and start the bot:

```bash
npm run deploy
npm start
```

## PostgreSQL + Website API

The bot can expose a small REST API for your website. It also works without PostgreSQL, but the database is recommended for a real website.

Add this to `.env`:

```env
DATABASE_URL=postgres://user:password@localhost:5432/itstiers
DATABASE_SSL=false
API_ENABLED=true
API_PORT=3000
CORS_ORIGIN=*
PVPCLUB_TOKEN=
STATIC_SITE_DIR=./site
```

Create the tables:

```bash
npm run migrate
```

Start the bot. The API starts with it:

```bash
npm start
```

Endpoints:

- `GET /api/health`
- `GET /api/modes`
- `GET /api/results?mode=mace&limit=50`
- `GET /api/players/lozk00`
- `GET /api/waitlists`
- `GET /api/waitlists/mace`
- `GET /api/leaderboard?mode=mace`

MCTiers-compatible endpoints for an existing frontend that calls `/api/v2`:

- `GET /api/v2/mode/list`
- `GET /api/v2/mode/overall?from=0&count=10`
- `GET /api/v2/mode/mace?from=0&count=10`
- `GET /api/v2/profile/lozk00`
- `GET /api/v2/profile/by-name/lozk00`
- `GET /api/v2/pvpclub/lozk00`

`PVPCLUB_TOKEN` is never sent to the browser. The static frontend should call `/api/v2/pvpclub/:uuidOrUsername`; the API resolves Minecraft usernames to UUIDs and forwards the request server-side.

If `STATIC_SITE_DIR` points to the bundled `site` folder, the API server also serves that website. With the example above, open:

```txt
http://localhost:3000
```

Example website fetch:

```js
const res = await fetch('http://localhost:3000/api/results?mode=mace');
const data = await res.json();
console.log(data.results);
```

## Hosting From GitHub

Use these values on a Discord bot host:

- build/install command: `npm install`
- start command: `npm start`
- Node.js: 20+

Set these environment variables in the host dashboard instead of committing `.env`:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `DATABASE_URL`
- `DATABASE_SSL=true`
- `API_ENABLED=true`
- `STATIC_SITE_DIR=./site`
- `PVPCLUB_TOKEN` if you want PvPClub custom names

## Website On Vercel

Vercel should host only the website and `/api/v2` serverless API. Keep the Discord bot on bot hosting.

1. Open [Vercel](https://vercel.com) and click `Add New` -> `Project`.
2. Import this GitHub repo: `lozkooszef-source/itstiers`.
3. Keep the project root as the repository root.
4. Framework preset: `Other`.
5. Build command: leave empty.
6. Output directory: leave empty.
7. Add environment variables:

- `DATABASE_URL`
- `DATABASE_SSL=true`
- `PVPCLUB_TOKEN` if you want PvPClub custom names

The included `vercel.json` serves the static frontend from `site/` and maps `/api/v2/...` to Vercel serverless functions.

## Commands

- `/setup` - sends the request panel with buttons to `request-test`.
- `/start mode:<mode>` - opens tester availability for that mode, adds you as an active tester and sends a fresh queue embed.
- `/stop mode:<mode>` - removes you from active testers. The queue only closes when no active testers remain.
- `/next mode:<mode>` - active testers only. Pulls the first player and opens a private testing ticket.
- `/close tier:<tier> [mode:<mode>]` - closes the active ticket/test and posts the result. Inside a testing ticket, `mode` is optional.
- `/leave mode:<mode>` - removes the user from a waitlist. Leave `mode` empty to leave all waitlists.

## Flow

1. The user clicks `Verify Account` and enters their Minecraft username.
2. Only verified users can click `Enter Waitlist`.
3. The user enters a mode and server/region, for example `Mace` and `EU`.
4. The bot creates or finds the private `waitlist-mace` channel under the waitlist category.
5. When testers are available, the user clicks `Join Queue` in that waitlist channel.
6. An active tester runs `/next mode:mace`.
7. The bot creates a private ticket named like `username-mace-current-tier-green-circle`.
8. The tester runs `/close tier:Low Tier 3` in that ticket.
9. The bot posts the result in `results` with an extra `Mode` field and closes the ticket.

When `/start mode:<mode>` or `/stop mode:<mode>` changes tester availability, the bot deletes old waitlist status embeds and sends a fresh status embed. The queue is preserved while at least one tester is still active.

## Bot Permissions

The bot needs:

- Manage Channels
- Manage Roles
- Send Messages
- Embed Links
- Use Slash Commands
- Read Message History
- Add Reactions

The bot role must be above the roles/categories it manages.
