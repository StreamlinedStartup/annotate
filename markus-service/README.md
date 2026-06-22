# MarkUS PocketBase Service

This directory contains the v1 self-hosted MarkUS service scaffold. It uses PocketBase for SQLite-backed persistence, realtime-ready collections, file storage, and the admin dashboard.

## Run Locally

```bash
PB_ADMIN_EMAIL=admin@example.com \
PB_ADMIN_PASSWORD=change-me-now \
PB_ENCRYPTION="$(openssl rand -hex 16)" \
docker compose up markus-pocketbase
```

PocketBase starts on `http://localhost:8090`. The admin dashboard is at `http://localhost:8090/_/`.

PocketBase does not publish an official Docker image. The Compose file pins the community `ghcr.io/muchobien/pocketbase:0.39.4` image and mounts committed migrations/hooks into the container.

## Collections

The initial migration creates these collections:

- `review_sessions`: configured review scopes with `slug`, hidden `publicKey`, status, and retention settings.
- `review_origins`: exact allowed browser origins per session, with optional `*` for development-only broad access.
- `review_comments`: top-level MarkUS annotation threads.
- `review_replies`: replies attached to comments.
- `review_solutions`: solution markers for comments or replies.
- `review_screenshots`: optional screenshot uploads for later UI work.

All direct collection rules are closed to public users. Public visitor access goes through `/api/markus/v1/...` hooks so review id, public key, and origin checks stay server-side.

## Seed a Review Session

Create a session and origin from the PocketBase admin UI:

1. Add `review_sessions` record:
   - `slug`: `launch-homepage-v3`
   - `publicKey`: `rvw_pub_local`
   - `enabled`: `true`
2. Add `review_origins` record:
   - `session`: the new session
   - `origin`: `http://localhost:4200`
   - `enabled`: `true`

Then embed the client with:

```html
<script
  src="http://localhost:4200/markus.js"
  data-review-id="launch-homepage-v3"
  data-api-base-url="http://localhost:8090"
  data-public-key="rvw_pub_local"
  defer></script>
```

## Public API

All public calls require:

- `Origin`: browser origin that matches an enabled `review_origins` record.
- `X-Markus-Public-Key`: public key matching the enabled `review_sessions` record.

Endpoints:

- `GET /api/markus/v1/health`
- `GET /api/markus/v1/reviews/{reviewId}/comments?pageKey=/path`
- `POST /api/markus/v1/reviews/{reviewId}/comments`
- `PATCH /api/markus/v1/reviews/{reviewId}/comments/{commentId}`
- `POST /api/markus/v1/reviews/{reviewId}/comments/{commentId}/replies`
- `POST /api/markus/v1/reviews/{reviewId}/solutions`

Example comment request:

```bash
curl -sS http://localhost:8090/api/markus/v1/reviews/launch-homepage-v3/comments \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:4200' \
  -H 'X-Markus-Public-Key: rvw_pub_local' \
  --data '{"pageKey":"/","annotationType":"note","author":"Reviewer","text":"Tighten this heading."}'
```

## Deployment Notes

Run the optional reverse proxy profile with:

```bash
MARKUS_PROXY_FROM=reviews.example.com docker compose --profile proxy up -d
```

Back up the service data volume before upgrades:

```bash
docker run --rm \
  -v hartford_markus_pb_data:/pb_data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/markus-pb-data.tgz -C /pb_data .
```

Restore into an empty data volume:

```bash
docker run --rm \
  -v hartford_markus_pb_data:/pb_data \
  -v "$PWD":/backup \
  alpine sh -c 'tar xzf /backup/markus-pb-data.tgz -C /pb_data'
```

## Security Placeholders

The hook validates review id, public key, and request origin, trims control characters from public text, and leaves the PocketBase collection APIs closed to guests. Before production exposure, replace the inline TODOs with persistent rate limiting keyed by IP/session/action and add stricter validators for URL normalization, geometry bounds, screenshot metadata, and optional CAPTCHA/Turnstile checks.

## Verification

```bash
docker compose config
sprout doctor
```
