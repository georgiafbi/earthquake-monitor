# Earthquake Monitor Worker (Cloudflare)

One Cloudflare Worker serves the whole app:

- **The site**: the repo root is uploaded as static assets (exclusions in
  `../.assetsignore`). Static files are served directly and never run code.
- **`/api/explain?id=<USGS event id>`**: Claude (`claude-opus-5-5`, low
  effort) explains one quake in three plain-English paragraphs. It powers the
  **✨ Explain this quake** button in the map popup.

The Anthropic API key is a Worker secret and never reaches the browser.

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
