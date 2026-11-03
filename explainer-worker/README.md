# Quake explainer (Cloudflare Worker)

Powers the **✨ Explain this quake** button in the map popup. The browser sends
only a USGS event id; the Worker fetches that event from USGS itself, asks
Claude (`claude-opus-5-5`, low effort) for a three-paragraph plain-English
explanation, and returns it.

Why a Worker: the site is public static hosting (GitHub Pages), so the Anthropic
API key cannot live in the page. It is a Worker secret and never leaves Cloudflare.

## Safety and cost controls

- **Not a general Claude proxy.** The only input is an event id (`^[a-z0-9]{4,40}$`);
  the prompt is built from data the Worker fetched from `earthquake.usgs.gov`.
- **Shared cache.** One explanation per event per USGS revision (`updated`),
  cached 7 days at the edge for every visitor. Bump `PROMPT_VERSION` in
  `src/index.js` to regenerate all of them after a prompt change.
- **Rate limit.** 6 *new* explanations per IP per minute (`wrangler.toml`);
  cached ones are unlimited.
- **Origin allow-list.** `ALLOWED_ORIGINS` in `wrangler.toml`.
- **Numbers are computed, not generated.** TNT-equivalent energy comes from
  Gutenberg-Richter in `src/prompt.js`; the model is told to use it.
- **Refusal fallback** (`fallbacks: "default"`) is enabled server side.

Roughly 1-2 US cents per new explanation.

## Commands

```sh
npm install
npm test                                   # unit tests for the prompt helpers
CLOUDFLARE_INCLUDE_PROCESS_ENV=true npm run dev   # local, port 8787, uses $ANTHROPIC_API_KEY
npx wrangler login                         # once
npx wrangler secret put ANTHROPIC_API_KEY  # once, use a dedicated key
npm run deploy
```

Then set the deployed `…workers.dev/explain` URL as the production value of
`EXPLAIN_API_URL` in `Leaflet-Step-1/static/js/explain-config.js`. While it is empty,
the live site hides the button.
