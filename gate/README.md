# gate

Cloudflare Worker that puts a password in front of client cases (`/work/<slug>/` and `/contents/<slug>/`). Slugs live in `LOCKED` in `wrangler.toml`.

Deploy:

    cd gate
    npx wrangler login
    npx wrangler secret put PASSWORD
    npx wrangler secret put SECRET   # any long random string
    npx wrangler deploy

Changing `PASSWORD` or `SECRET` logs everyone out. New client case: add its slug to `LOCKED` and redeploy.

Local test: serve the built site (`python3 -m http.server 8000` at the repo root), then `npx wrangler dev --var ORIGIN:http://localhost:8000 --var PASSWORD:test --var SECRET:dev`.
