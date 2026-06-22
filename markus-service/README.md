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

PocketBase does not generate MarkUS public review keys automatically. Generate
one when you create a review session, store it in `review_sessions.publicKey`,
and put the same value in the browser embed as `data-public-key`.

```bash
MARKUS_PUBLIC_KEY="rvw_pub_$(openssl rand -hex 24)"
printf '%s\n' "$MARKUS_PUBLIC_KEY"
```

The `rvw_pub_` prefix is a convention for readability; the random suffix is the
important part. Public review keys are browser-visible scoped capabilities, not
admin secrets. Do not reuse PocketBase admin credentials, API tokens, passwords,
or a `PB_ENCRYPTION` value as a public key.

Create a session and origin from the PocketBase admin UI:

1. Add `review_sessions` record:
   - `slug`: `launch-homepage-v3`
   - `publicKey`: the generated `rvw_pub_...` value
   - `enabled`: `true`
2. Add `review_origins` record:
   - `session`: the new session
   - `origin`: exact browser origin, for example `http://localhost:4200`
   - `enabled`: `true`

Then embed the client with:

```html
<script
  src="http://localhost:4200/markus.js"
  data-review-id="launch-homepage-v3"
  data-api-base-url="http://localhost:8090"
  data-public-key="rvw_pub_..."
  defer></script>
```

The browser sends that key as `X-Markus-Public-Key`. The hook accepts the
request only when all of these match:

- `{reviewId}` route segment equals an enabled `review_sessions.slug`.
- `X-Markus-Public-Key` equals that session's `publicKey`.
- The request `Origin` exactly matches an enabled `review_origins.origin` for
  the same session.

Use one public key per review session. To rotate access, replace
`review_sessions.publicKey`, update every embed using that session, and disable
or remove stale origins that should no longer post comments.

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
  -H 'X-Markus-Public-Key: rvw_pub_...' \
  --data '{"pageKey":"/","annotationType":"note","author":"Reviewer","text":"Tighten this heading."}'
```

## Deployment Notes

The Compose file only runs PocketBase. For production, terminate TLS in your
own proxy or hosting platform and keep PocketBase admin access restricted to
trusted operators.

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
