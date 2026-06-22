# MarkUS PocketBase Service

This directory contains the v1 self-hosted MarkUS service scaffold. It uses PocketBase for SQLite-backed persistence, realtime-ready collections, file storage, and the admin dashboard.

## Run Locally

```bash
PB_ADMIN_EMAIL=admin@example.com \
PB_ADMIN_PASSWORD=change-me-now \
PB_ENCRYPTION="$(openssl rand -hex 16)" \
MARKUS_SETUP_TOKEN="$(openssl rand -hex 24)" \
docker compose up markus-pocketbase
```

PocketBase listens on container port `8090`; Coolify can route that service
port directly. For a local Compose run, inspect the published host port with
`docker compose port markus-pocketbase 8090`.

The Compose command intentionally passes only PocketBase flags. The pinned
image entrypoint creates or updates the superuser from `PB_ADMIN_EMAIL` and
`PB_ADMIN_PASSWORD` before serving, but only when the command is empty or starts
with a flag.

PocketBase does not publish an official Docker image. The Compose file builds
from the pinned community `ghcr.io/muchobien/pocketbase:0.39.4` image and copies
the committed migrations/hooks into the container image so Coolify does not need
host bind mounts.

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

Use the MarkUS setup page when you need a new review session:

```text
https://reviews.example.com/markus/setup
```

For local Compose runs, use the host and port printed by:

```bash
docker compose port markus-pocketbase 8090
```

The setup page can be opened without credentials, but creating a review requires
the `MARKUS_SETUP_TOKEN`. The page sends that value as a bearer token only for
the create request; it does not store the token, put it in the URL, or include
it in generated output.

Fill in:

- `Setup token`: the operator-issued `MARKUS_SETUP_TOKEN`.
- `Review name`: human label, for example `Launch homepage v3`.
- `Project`: optional grouping label.
- `Review ID`: optional slug. Leave blank to generate one from the name.
- `Page URL or origins`: one full URL or exact origin per line. Full URLs are
  converted to exact browser origins.
- `Page key`: usually `/` or the path being reviewed.

The result shows:

- the `reviewId` / session slug,
- the generated browser-visible `publicKey`,
- the exact allowed origins,
- a copyable `<script>` tag,
- a test link for the first origin and page key.

The generated script tag uses `MARKUS_SCRIPT_URL` for `src` and
`MARKUS_PUBLIC_BASE_URL` for `data-api-base-url`.

Automated setup can call the same endpoint:

```bash
curl -sS https://reviews.example.com/api/markus/setup/reviews \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MARKUS_SETUP_TOKEN" \
  --data '{
    "name": "Launch homepage v3",
    "project": "Hartford",
    "origins": ["https://staging.example.com"],
    "pageKey": "/",
    "allowScreenshots": false,
    "stripQuery": true,
    "retentionDays": 0
  }'
```

Manual database setup remains available as an operator fallback. PocketBase does
not generate MarkUS public review keys from the admin UI, so generate one when
you manually create a review session, store it in `review_sessions.publicKey`,
and put the same value in the browser embed as `data-public-key`.

```bash
MARKUS_PUBLIC_KEY="rvw_pub_$(openssl rand -hex 24)"
printf '%s\n' "$MARKUS_PUBLIC_KEY"
```

The `rvw_pub_` prefix is a convention for readability; the random suffix is the
important part. Public review keys are browser-visible scoped capabilities, not
admin secrets. Do not reuse PocketBase admin credentials, API tokens, passwords,
or a `PB_ENCRYPTION` value as a public key.

Create a session and origin from the PocketBase admin UI only when you need the
manual fallback:

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
  data-api-base-url="https://reviews.example.com"
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
curl -sS https://reviews.example.com/api/markus/v1/reviews/launch-homepage-v3/comments \
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
