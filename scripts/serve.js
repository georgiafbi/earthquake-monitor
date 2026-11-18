// @ts-check
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT_DIR = path.resolve(__dirname, "..");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg"
};

function createServer(port = PORT, rootDir = ROOT_DIR) {
    const server = http.createServer((req, res) => {
        const rawUrl = req.url || "/";
        const parsedUrl = new URL(rawUrl, `http://localhost:${port}`);
        let pathname = decodeURIComponent(parsedUrl.pathname);

        if (pathname === "/") {
            pathname = "/index.html";
        }

        const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(rootDir, safePath);

        // Security check: ensure path is within rootDir
        if (!filePath.startsWith(rootDir)) {
            res.writeHead(403, { "Content-Type": "text/plain" });
            res.end("403 Forbidden");
            return;
        }

        fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end(`404 Not Found: ${pathname}`);
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || "application/octet-stream";

            res.writeHead(200, {
                "Content-Type": contentType,
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Access-Control-Allow-Origin": "*"
            });

            fs.createReadStream(filePath).pipe(res);
        });
    });

    return server;
}

if (require.main === module) {
    const server = createServer(PORT, ROOT_DIR);
    server.listen(PORT, () => {
        console.log(`\n🌍 Earthquake Monitor dev server running at:`);
        console.log(`   ➜ Local:   http://localhost:${PORT}/`);
        console.log(`   ➜ Tests:   http://localhost:${PORT}/Leaflet-Step-1/tests/logic-tests.html`);
        console.log(`\nPress Ctrl+C to stop.\n`);
    });
}

module.exports = { createServer, MIME_TYPES, ROOT_DIR };
