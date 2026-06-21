# Live Shared Review Threads

## Summary

Rename the product layer to **MarkUS**: a punny "mark us up" feedback layer.
Convert the current local-only annotation widget into a live shared review
system for hosted pages.

The browser script remains a static CDN asset, while live storage, realtime
updates, admin controls, and exports are handled by a self-hosted
PocketBase-backed MarkUS service deployed with Docker Compose.

```html
<script
  src="https://unpkg.com/@markus/client@x.y.z/markus.js"
  data-review-id="launch-homepage-v3"
  data-api-base-url="https://reviews.example.com"
  data-public-key="rvw_pub_..."
  defer>
</script>
```

Defaults:

- Self-hosted from v1.
- Docker Compose is the primary deployment path.
- PocketBase is the v1 backend because it provides SQLite storage, auth, file
  storage, admin UI, REST-ish APIs, and realtime subscriptions in one small
  self-hostable service.
- Comments are visible/writeable by public page visitors only for explicitly
  configured review sessions and origins.
- Any reviewer can mark one or more comments/replies as a solution.
- Agent-facing exports prioritize solution-marked items while preserving full
  thread context.

## Key Changes

- Public product name: **MarkUS**.
- Browser asset: `markus.js`.
- Global API: `window.MarkUS`.
- Package name target: `@markus/client`.
- Publish `markus.js` to npm/unpkg/jsDelivr as a static client script.
- Add live mode only when `data-review-id`, `data-api-base-url`, and
  `data-public-key` are present.
- Keep current localStorage/export/import behavior when live config is absent.
- Add a self-hosted PocketBase service with collections for review sessions,
  allowed origins, comments, replies, solution markers, and optional
  screenshots.
- Add PocketBase hooks for public-key validation, origin checks, rate limiting,
  sanitization, and export shaping.
- Add Docker Compose starter with `markus-pocketbase`, optional Caddy reverse
  proxy, persistent volumes, environment variables, and backup/restore docs.

## Live Behavior

- On load, `markus.js` fetches comments for `{reviewId, pageKey}` from the
  configured PocketBase-backed API origin.
- New comments and replies are created through scoped public endpoints.
- Other visitors receive PocketBase realtime updates and see shared threads
  without reloading.
- localStorage becomes offline/draft cache and reviewer identity storage, not
  the source of truth in live mode.
- The comments panel becomes a live shared thread list with filters for Open,
  Solutions, Resolved, and All.
- Each comment/reply can be marked as a solution. Agent exports list
  solution-marked items first, then include the surrounding thread context.
- If the backend is unavailable, the client shows an offline draft state,
  queues pending writes locally, retries explicitly, and offers JSON download
  fallback.

## Security Model

- Each review session has a non-secret `publicKey` used by the browser.
- Writes are accepted only when `reviewId`, `publicKey`, request `Origin`, and
  page URL match an enabled session.
- PocketBase API rules restrict collection access; custom hooks enforce checks
  that collection rules cannot safely express alone.
- Public keys authorize scoped review actions only.
- Admin exports, moderation, session creation, closure, and retention settings
  require PocketBase admin auth or an admin token.
- Rate limit by IP, review session, and action type.
- Enforce payload size limits for comments, replies, anchors, geometry, and
  screenshots.
- Sanitize all rendered text and never render reviewer content as HTML.
- Validate URL, origin, geometry, selectors, page keys, and screenshot metadata
  at the API boundary.
- Soft-delete comments/replies for auditability.
- Optional CAPTCHA/Turnstile support can be enabled per deployment.
- Strip URL fragments and optionally strip query strings before storing.
- Never log comment body text, screenshots, cookies, authorization headers, or
  full URLs with sensitive query params.

## API / Data Model

Client config:

- `data-review-id`: required for live shared mode.
- `data-api-base-url`: self-hosted MarkUS/PocketBase origin.
- `data-public-key`: public scoped key for this review session.
- `data-realtime`: optional, default `true`.
- `data-project`: optional display/grouping label.
- `data-page`: optional explicit page key; defaults to current path.

PocketBase collections:

- `review_sessions`
- `review_origins`
- `review_comments`
- `review_replies`
- `review_solutions`
- `review_screenshots`

Client operations:

- list page comments
- create comment
- update comment text/status
- create reply
- update reply text
- add/remove solution marker
- export review bundle for Codex/admin use

Realtime events:

- `comment.created`
- `comment.updated`
- `comment.deleted`
- `reply.created`
- `reply.updated`
- `solution.created`
- `solution.deleted`

## Test Plan

- `docker compose up` starts MarkUS/PocketBase from a clean checkout.
- Healthcheck passes after PocketBase is ready and migrations are applied.
- Persistent volumes survive container restart.
- Reverse-proxy/TLS docs include settings needed for PocketBase realtime.
- Reject unknown origins, invalid public keys, disabled sessions, oversized
  payloads, malformed geometry, and unauthorized exports.
- Verify public keys cannot call admin/export/moderation paths.
- Verify PocketBase collection rules block direct unauthorized access.
- Verify comments are escaped in UI and report/export output.
- Verify rate limits apply per IP/session/action.
- Verify two browser contexts on the same review session see the same comments.
- Verify replies and solution markers sync live without reload.
- Verify local JSON export/import still works.
- Verify solution-marked replies are prioritized in agent exports and resolved
  state is not conflated with solution state.

## Assumptions

- `markus.js` is the only public script name/API for the new product direction.
- Live behavior requires a configured self-hosted MarkUS backend origin.
- Docker Compose is the primary supported deployment path for v1.
- PocketBase is suitable for v1; if future scale exceeds PocketBase/SQLite
  constraints, the API contract should stay stable while the backing store
  changes.
- Screenshot crops and email reports should be layered on after live
  persistence, replies, and solution markers are stable.
