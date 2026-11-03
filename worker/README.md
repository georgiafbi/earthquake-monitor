# Earthquake Monitor Worker (Cloudflare)

One Cloudflare Worker serves the whole app:

- **The site**: the repo root is uploaded as static assets (exclusions in
  `../.assetsignore`). Static files are served directly and never run code.
- **`/api/explain?id=<USGS event id>`**: Claude (`claude-opus-5-5`, low
  effort) explains one quake in three plain-English paragraphs. It powers the
  **✨ Explain this quake** button in the map popup.
- **`/api/quest/load|save|log|board`** (POST): Quake Quest gamer tags.

The Anthropic API key is a Worker secret and never reaches the browser.

## Quake Quest gamer tags

Players use the same **Emberkite gamer tag** as Airship Dash. Claiming,
PIN sign-in, recovery and transfer codes are all handled by Airship Dash's
API (`https://airshipdash.emberkitegames.com/api/...`, which allows this
site's origin); this Worker only checks the device token it hands out,
against the same D1 database (`bhalo-scores`, binding `DB`). Tables
`quest_saves` and `quest_log` are created on first use (`src/quest-api.js`).

- **Cloud save**: one JSON blob per player (64 KB cap). Signing in on a
  device merges local and cloud progress, keeping the best of each.
- **Activity log**: one row per player per quake (`INSERT OR IGNORE`), sent
  in batches of 25 and queued in the browser while offline. Depth answers
  are re-checked against USGS; energy answers are always correct; boundary
  answers are kept but marked unchecked. The newest 5,000 per player stay.
- **Leaderboard**: top 20 plus your own place. XP counts only up to
  `25 × predictions + 375 + 350 + 120 × active days`, so an edited save
  can't top it. Tester tags are left out.
- **Admin**: Airship Dash's admin page has a Quake Quest card (players, XP
  warnings, each player's log, reset).

Locally, run Airship Dash's emulator with `--d1 DB=<this database id>` and
this Worker with the same `--persist-to` folder so both see one database;
on `localhost:3000` the game uses `localStorage['emberkite.idApi']` (e.g.
`http://127.0.0.1:8788/api`) for the identity API.

## Safety and cost controls

- **Not a general Claude proxy.** The only input is an event id (`^[a-z0-9]{4,40}$`);
  the prompt is built from data the Worker fetched from `earthquake.usgs.gov`.
- **Shared cache.** One explanation per event per USGS revision (`updated`),
  cached 7 days at the edge for every visitor. Bump `PROMPT_VERSION` in
  `src/index.js` to regenerate all of them after a prompt change.
- **Rate limit.** 6 *new* explanations per IP per minute (`wrangler.toml`);
  cached ones are unlimited.
- **Callers.** The site's own pages (same origin) plus `ALLOWED_ORIGINS`
  (`http://localhost:3000` for `npm start`). Requests without browser
  same-origin headers are refused.
- **Numbers are computed, not generated.** TNT-equivalent energy comes from
  Gutenberg-Richter in `src/prompt.js`; the model is told to use it.
- **Refusal fallback** (`fallbacks: "default"`) is enabled server side.

Roughly 1-2 US cents per new explanation. Use a dedicated API key
(`earthquake-app-proxy`) with a spend limit in the Claude Console.

## Commands (run in this folder)

```sh
npm install
npm test                                   # unit tests for the prompt and caller helpers
CLOUDFLARE_INCLUDE_PROCESS_ENV=true npm run dev   # site + API at http://localhost:8787, uses $ANTHROPIC_API_KEY
npx wrangler login                         # once
npm run deploy                             # manual; normally not needed (see Deploys)
```

The API key is a Worker secret. Set or change it in the Cloudflare dashboard
(Worker → Settings → Variables and Secrets): `wrangler secret put` run without
a terminal prompt stores an empty value.

`npm start` at the repo root (port 3000) still works for the site and the
browser tests; its Explain button calls the dev Worker on port 8787.

## Deploys

Pushing to `master` deploys automatically (Cloudflare Workers Builds, root
directory `worker`, command `npx wrangler deploy`). Preview builds of other
branches are off. Watch builds under the Worker's **Deployments** tab.
