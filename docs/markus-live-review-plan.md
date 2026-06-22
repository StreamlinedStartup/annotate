# Live Shared Review Threads

## Summary

Rename the product layer to **MarkUS**: a punny “mark us up” feedback layer. Convert the current local-only annotation widget into a live shared review system for hosted pages.

The browser script remains a static CDN asset, while live storage, realtime updates, admin controls, and exports are handled by a **self-hosted PocketBase-backed MarkUS service** deployed with Docker Compose.

Current implementation status:
- MarkUS naming is present in package metadata, `markus.js`, and the canonical `window.MarkUS` API alias.
- The browser client enters live mode when `data-review-id`, `data-api-base-url`, and `data-public-key` are all present.
- The comments panel has Open / Solutions / Resolved / All filters and solution markers for comments and replies.
- The PocketBase service scaffold, collections, migrations, Docker Compose service, optional Caddy profile, and public hook routes are present.
- Admin exports and full PocketBase realtime subscriptions remain planned follow-up work; JSON download/import remains the portable fallback.

Embed model:

```html
<script
  src="https://unpkg.com/@markus/client@x.y.z/markus.js"
  data-review-id="launch-homepage-v3"
  data-api-base-url="https://reviews.example.com"
  data-public-key="rvw_pub_..."
  defer>
</script>
```

Chosen defaults:
- Self-hosted from v1.
- Docker Compose is the primary deployment path.
- PocketBase is the v1 backend because it provides SQLite storage, auth, file storage, admin UI, REST-ish APIs, and realtime subscriptions in one small self-hostable service.
- Comments are visible/writeable by public page visitors only for explicitly configured review sessions/origins.
- Any reviewer can mark one or more comments/replies as a solution.
- Agent-facing exports prioritize solution-marked items while preserving full thread context.

## Key Changes

- Introduce MarkUS naming:
  - Public product name: **MarkUS**.
  - Browser asset: `markus.js`.
  - Global API: `window.MarkUS`.
  - Package name target: `@markus/client`.

- Keep the browser client as a static CDN script:
  - Publish `markus.js` to npm/unpkg/jsDelivr.
  - Add live mode only when `data-review-id`, `data-api-base-url`, and `data-public-key` are present.
  - Without live config, keep current localStorage/export/import behavior.

- Add a self-hosted PocketBase service:
  - Use PocketBase as the embedded database, realtime server, file store, and admin console.
  - Add MarkUS collections/migrations for review sessions, allowed origins, comments, replies, solution markers, and optional screenshot files.
  - Add PocketBase server hooks where collection rules alone are not enough, especially for public-key validation, origin checks, rate limiting, sanitization, and export shaping.
  - Store data in mounted Docker volumes.
  - Keep direct public collection rules closed; expose public review actions only through MarkUS hook routes.

- Add Docker Compose starter:
  - `markus-pocketbase`
  - optional `caddy` reverse proxy for TLS
  - persistent volumes for PocketBase data and uploaded screenshots
  - environment variables for public base URL, admin bootstrap settings, signing/public-key secrets, allowed origins, SMTP, upload limits, retention, and rate limits
  - documented backup/restore commands for the PocketBase data volume

- Add live sync behavior:
  - On load, `markus.js` fetches comments for `{reviewId, pageKey}` from PocketBase-backed endpoints.
  - New comments/replies are created through scoped public endpoints.
  - Other visitors receive PocketBase realtime updates and see shared threads without reload.
  - localStorage becomes offline/draft cache and reviewer identity storage, not the source of truth in live mode.
  - Current client-side offline behavior stores failed writes as explicit offline drafts and displays that state in the UI.

- Add “solution” markers:
  - A solution can point to the original comment or one/more replies.
  - Any reviewer can toggle solution markers.
  - UI labels marked items as “Solution” or “Implement this.”
  - Agent exports prioritize solution-marked items while preserving full discussion.

## Security Model

- Public embed security:
  - Each review session has a non-secret `publicKey` used by the browser.
  - Writes are accepted only when `reviewId`, `publicKey`, request `Origin`, and page URL match an enabled session.
  - PocketBase API rules restrict collection access; custom hooks enforce public-key/origin checks that rules cannot safely express alone.
  - Public keys authorize scoped review actions only; admin/export/moderation actions require admin authentication or an admin token.

- Admin security:
  - PocketBase admin UI is used for local/self-hosted administration.
  - Admin credentials/tokens are never exposed to `markus.js`.
  - Full exports, moderation, session creation, session closure, and retention settings require admin authorization.

- Abuse controls:
  - Rate limit by IP, review session, and action type in PocketBase hooks.
  - Enforce payload size limits for comments, replies, anchors, geometry, and screenshots.
  - Sanitize all rendered text; never render reviewer content as HTML.
  - Validate URL, origin, geometry, selectors, page keys, and screenshot metadata at the API boundary.
  - Soft-delete comments/replies instead of hard delete for auditability.
  - Optional CAPTCHA/Turnstile hook can be enabled per deployment if public pages attract spam.

- Privacy controls:
  - Strip URL fragments and optionally strip query strings before storing.
  - Never log comment body text, screenshots, cookies, authorization headers, or full URLs with sensitive query params.
  - Configurable retention for screenshots and old sessions.
  - Screenshot capture is opt-in per session/deployment.

## API / Embed Contract

- CDN script config:
  - `data-review-id`: required for live shared mode.
  - `data-api-base-url`: self-hosted MarkUS/PocketBase origin, for example `https://reviews.example.com`.
  - `data-public-key`: public scoped key for this review session.
  - `data-realtime`: optional, default `true`.
  - `data-project`: optional display/grouping label.
  - `data-page`: optional explicit page key; defaults to current path.
  - Equivalent JavaScript config lives on `window.MarkUSConfig`; `window.AnnotateConfig` remains a compatibility alias.

- Public PocketBase hook routes:
  - `GET /api/markus/v1/health`
  - `GET /api/markus/v1/reviews/{reviewId}/comments?pageKey=/path`
  - `POST /api/markus/v1/reviews/{reviewId}/comments`
  - `PATCH /api/markus/v1/reviews/{reviewId}/comments/{commentId}`
  - `POST /api/markus/v1/reviews/{reviewId}/comments/{commentId}/replies`
  - `POST /api/markus/v1/reviews/{reviewId}/solutions`

- Endpoint alignment note:
  - The checked-in browser live data layer enables from the live embed attributes and expects the configured service origin to provide the review API under the client route prefix used by that client version.
  - When deploying the PocketBase scaffold, align the reverse proxy/API prefix with the deployed client before exposing live review sessions.

- MarkUS client operations:
  - list page comments
  - create comment
  - update comment text/status
  - create reply
  - update reply text/status
  - add/remove solution marker
  - export review bundle for Codex/admin use

- PocketBase collections:
  - `review_sessions`
  - `review_origins`
  - `review_comments`
  - `review_replies`
  - `review_solutions`
  - `review_screenshots`

- Realtime events:
  - Use PocketBase realtime subscriptions for comment, reply, solution, and deletion/status updates.
  - Client maps raw record changes into:
    - `comment.created`
    - `comment.updated`
    - `comment.deleted`
    - `reply.created`
    - `reply.updated`
    - `reply.deleted`
    - `solution.created`
    - `solution.deleted`

## UI Behavior

- The comments panel becomes a live shared thread list.
- Filters become:
  - Open
  - Solutions
  - Resolved
  - All
- Thread cards show:
  - original comment,
  - replies,
  - solution badge/buttons on each comment/reply,
  - live updates without closing drafts.
- Solution markers are independent from resolved state.
- If the backend is unavailable:
  - show “Offline draft” state,
  - queue pending writes locally,
  - retry explicitly,
  - offer JSON download fallback,
  - never silently pretend a comment was shared.

## Documentation / Examples

- The top-level README documents:
  - MarkUS naming and `@markus/client` script usage.
  - Local-only mode as the unchanged no-backend fallback.
  - Live shared embed attributes.
  - Docker Compose service startup, session/origin setup, reverse proxy, backup/restore, and admin security.
  - Agent export expectations around solution markers.
- Examples cover:
  - Plain HTML live embed.
  - `data-start-open` live embed.
  - React integration that loads MarkUS once after React mounts.

## Test Plan

- Docker Compose tests:
  - `docker compose up` starts MarkUS/PocketBase from a clean checkout.
  - Healthcheck passes after PocketBase is ready and migrations are applied.
  - Persistent volumes survive container restart.
  - Reverse-proxy/TLS docs include headers/settings needed for PocketBase realtime.

- Security/API tests:
  - Reject unknown origins, invalid public keys, disabled sessions, oversized payloads, malformed geometry, and unauthorized exports.
  - Verify public key cannot call admin/export/moderation paths.
  - Verify PocketBase collection rules block direct unauthorized access.
  - Verify comments are escaped in UI and report/export output.
  - Verify rate limits apply per IP/session/action.

- Browser realtime tests:
  - Two browser contexts on the same review session see the same comments.
  - A reply posted in one context appears in the other without reload.
  - Solution markers on comments and replies sync live.
  - Solutions filter shows solution-marked threads/items.
  - Existing local JSON export/import still works.

- Agent export tests:
  - Solution-marked replies are prioritized over general thread discussion.
  - Multiple solution markers are preserved.
  - Resolved and solution states are not conflated.

## Assumptions

- Public product name is **MarkUS**.
- `markus.js` is the only public script name/API for the new product direction.
- Live behavior requires a configured self-hosted MarkUS backend origin.
- Docker Compose is the primary supported deployment path for v1.
- PocketBase is suitable for v1 because it bundles SQLite, realtime, auth, file storage, and an admin UI in one self-hostable service.
- If future scale exceeds PocketBase/SQLite constraints, the API contract should stay stable while the backing store changes.
- Public visitor commenting is allowed only for configured review sessions and origins.
- Any reviewer can mark solutions, but exports include who marked them so agents and humans can audit the instruction source.
- Screenshot crops and email reports should be layered on after live persistence/replies/solution markers are stable.
