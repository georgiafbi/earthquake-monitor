// Claude quake explainer endpoint (worker/src/index.js). Not a secret: the
// Worker holds the Anthropic key. In production the Worker also serves this
// site, so the API is same-origin. `npm start` (localhost:3000) has no API, so
// it calls the Worker's dev server (`npm run dev` in worker/, port 8787).
// GitHub Pages has no API, so the button stays hidden there.
const EXPLAIN_API_URL = location.hostname === "localhost" && location.port === "3000"
    ? "http://localhost:8787/api/explain"
    : /\.github\.io$/.test(location.hostname)
        ? ""
        : "/api/explain";
