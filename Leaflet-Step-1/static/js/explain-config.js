// Claude quake explainer (explainer-worker/, a Cloudflare Worker). This URL is
// not a secret: the Worker holds the Anthropic key and only accepts this site's
// origins. Local dev talks to `npm run dev` in explainer-worker/ on port 8787.
// While the production value is empty, the live site hides the Explain button.
const EXPLAIN_API_URL = location.hostname === "localhost"
    ? "http://localhost:8787/explain"
    : "";
