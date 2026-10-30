# LiveBridge improvement plan — config + error handling

Goal: one place to configure the app (no code edits for users) and errors that tell the user exactly how to fix the problem.

Phases are ordered **hardest first**. Each phase lists why it is hard, the files it touches, steps, and how to verify it. Run `pnpm typecheck` after every phase and smoke-test `pnpm dev` (start a live session, copy the OBS link, open `/obs?key=...`).

| # | Phase | Difficulty | Risk |
|---|-------|------------|------|
| 1 | Central config (`livebridge.config.ts` + `lib/config.ts`) | Hard | High — touches server, client, SDK types |
| 2 | Error contract (codes + shared helpers + client mapping) | Hard | Medium — large client component |
| 3 | Upstream provider error mapping, timeouts, non-JSON | Medium | Medium — SDK error shapes unknown |
| 4 | Startup config validation (`instrumentation.ts`) | Medium | Low |
| 5 | Dev loopback auto-allow for origins | Medium | Security-sensitive |
| 6 | UI resilience: silent catches + error boundaries | Easy | Low |
| 7 | Docs + cleanup | Easy | Low |

---

## Phase 1 — Central config (hardest)

**Why hard**
- Must keep secrets server-only while sharing non-secret values (modes, upload limit, branding) with client components.
- Model names flow into `models.realtime(modelName)` from `@decartai/sdk` (`components/live-studio.tsx:386`) and into type guards (`isRealtimeModelName`, `isFalLucyApp`). Literal types must survive the move (`as const satisfies ...`), and user-edited values must be validated at load time.
- Values are duplicated today: 10 MB limit in `live-studio.tsx` (lines 58, 735, 774); token TTLs inside routes; FAL app IDs/prompts in `lib/fal-models.ts`; modes in `lib/decart.ts`.
- `app.config.ts` exists but is never imported (logo setting is dead).

**Design**
- `.env` — secrets and deployment values only: `LIVE_PROVIDER`, `DECART_API_KEY`, `FAL_KEY`, `APP_ORIGINS`, `OBS_KEY`.
- `livebridge.config.ts` (replaces `app.config.ts`) — every non-secret setting, commented:
  - `branding.logoUrl`, app name
  - `modes[]`: `id`, `label`, `detail`, `decartModel`, `falApp`, `falPrompt`
  - `tokens.decartTtlSeconds` (300), `tokens.falTtlSeconds` (120)
  - `upload.maxImageMb` (10), accepted MIME types
  - `obs.statusPollMs` (if applicable)
  - `dev.allowLoopbackOrigins` (used in Phase 5)
- `lib/config.ts` (`server-only`) — the **only** file that reads `process.env`. Merges env + `livebridge.config.ts`, validates, exports a typed `serverConfig` and a `getConfigStatus()` result (`{ ok, missing[], invalid[] }`).
- `lib/public-config.ts` — client-safe subset (modes, upload, branding). No env access.

**Steps**
- [x] Create `livebridge.config.ts` with current values (behavior unchanged). Types live in `lib/config-types.ts`.
- [x] Create `lib/public-config.ts`; `lib/decart.ts` and `lib/fal-models.ts` kept as thin helpers that read from it (`RealtimeModelName` = SDK `RealTimeModels`).
- [x] Validate at load: unique ids, non-empty labels, `decartModel` via SDK `isRealtimeModel`, `falApp` in allowed FAL apps, TTLs, upload size, logo URL. Errors name the exact field.
- [x] Create `lib/config.ts` (`server-only`) with env getters (`getLiveProvider`, `getDecartApiKey`, `getFalKey`, `getObsViewKey`, `getConfiguredAppOrigins`, `isAllowedRequestOrigin`, `getServerConfigurationStatus`).
- [x] Replace every `process.env.*` read in `app/api/**` and `lib/**`.
- [x] Replace hardcoded 10 MB limit / labels in `components/live-studio.tsx`; FAL TTL in `lib/fal-lucy-session.ts`.
- [x] Wire `branding.appName` + `branding.logoUrl` into the header and page title.
- [x] Delete `app.config.ts` and `lib/server-config.ts`.
- Not done (kept behavior): accepted MIME types still use Mantine's `IMAGE_MIME_TYPE`; `dev.allowLoopbackOrigins` deferred to Phase 5.

**Verify**
- [x] `grep process.env` → only `lib/config.ts`.
- [x] `pnpm typecheck` passes; `lib/public-config.ts` has no env access and `lib/config.ts` is guarded by `server-only`.
- [x] Studio, `/obs`, `/api/config/status`, `/api/obs/link` (good/bad origin), `/api/realtime-token` (bad model) behave as before.
- [x] A typo in a model name produces: `[livebridge.config.ts] modes[1].decartModel "lucy-restyle-9" is not a Decart realtime model. Valid: ...`

---

## Phase 2 — Error contract (hard)

**Why hard**
- `components/live-studio.tsx` is large with ~20 `setError` paths, including SDK callbacks; `components/obs-viewer.tsx` has its own path.
- Origin check is duplicated in 4 routes (two re-implement it instead of using `isAllowedRequestOrigin`); `no-store` header repeated everywhere.

**Design**
- Response shape: `{ code, message, hint? }`.
- Codes: `CONFIG_MISSING`, `CONFIG_INVALID`, `ORIGIN_NOT_ALLOWED`, `PROVIDER_INACTIVE`, `BAD_REQUEST`, `UNSUPPORTED_MODEL`, `UPSTREAM_AUTH`, `UPSTREAM_QUOTA`, `UPSTREAM_UNAVAILABLE`, `UPSTREAM_ERROR`, `INTERNAL`.
- `lib/api.ts`: `jsonError(status, code, message, hint?)`, `jsonOk(data)`, `requireOrigin(request)`, `readJson(request)`.
- In development, `ORIGIN_NOT_ALLOWED` hint includes the received origin: *"Add `http://127.0.0.1:63740` to APP_ORIGINS in .env and restart."* Production hint stays generic.

**Steps**
- [x] Add `lib/api.ts` (server: `jsonOk`, `noContent`, `jsonError`, `missingConfig`, `requireOrigin`, `readJson`) and `lib/errors.ts` (shared `ErrorCode`, `ApiErrorBody`, `isApiErrorBody`). Added codes `RATE_LIMITED` and client-only `NETWORK`.
- [x] Refactor all 6 routes. Removed duplicate `FAL_KEY` check, the try/catch around sync `publishObsSession`, and unused `isAllowedRequestOrigin`. Decart token route now checks `DECART_API_KEY` directly (previously used provider-wide status).
- [x] Add `lib/api-client.ts`: `fetchJson()` throws `ApiError { code, status, hint }`, maps network failures to `NETWORK` and non-JSON/HTML errors to `INTERNAL`, rethrows aborts unchanged; `toErrorView()` for display.
- [x] Messages: server messages are already user-facing, so no separate client mapping file; client only supplies fallbacks for `NETWORK`/non-JSON. Used in `live-studio.tsx`, `obs-viewer.tsx`, `fal-lucy-session.ts`.
- [x] Studio error alert shows `hint` under the message.

**Verify**
- [x] curl: no Origin / wrong Origin (dev hint echoes origin) / bad JSON / array body / bad model / FAL inactive / bad OBS session / rate limit (429 + `Retry-After`) → correct status + code + hint.
- [ ] Manual: start a live session in the browser and confirm hints render (not run — avoids minting real tokens).

---

## Phase 3 — Upstream errors, timeouts, non-JSON (medium)

**Why medium**: Decart SDK error shape must be inspected (status/code fields), and FAL responses may be HTML on outages.

**Steps**
- [x] FAL token route: `AbortSignal.timeout(10_000)` on `fetch`; parse JSON only when `content-type` is JSON, otherwise log the text body.
- [x] Map upstream status → code in `lib/upstream.ts`: 401/403 → `UPSTREAM_AUTH` (502), 402/429 → `UPSTREAM_QUOTA` (429), 5xx → `UPSTREAM_UNAVAILABLE` (503), timeout → `UPSTREAM_UNAVAILABLE` (504), network → `UPSTREAM_UNAVAILABLE` (503), other → `UPSTREAM_ERROR` (502).
- [x] Decart token route: SDK throws plain `{ code, message, data.status }` objects (not `Error`), so the old log always said "Unknown token error" — now classified and logged correctly. Wrapped in `withTimeout()` (SDK has no signal option).
- [x] Upstream detail logged server-side only (truncated to 500 chars); responses never include raw upstream bodies.

**Verify**
- [x] Invalid key (real calls, fake keys via shell env) → Decart and FAL both return `UPSTREAM_AUTH` with the right key name in the hint; server log shows the real 401 reason.
- [ ] Network failure / timeout not simulated (needs blocking outbound traffic); classification covered by code review only.

---

## Phase 4 — Startup config validation (medium)

**Steps**
- [x] Read the Next 16 instrumentation docs (root `instrumentation.ts`, `register()` runs once before the server is ready; gate on `NEXT_RUNTIME === "nodejs"`).
- [x] `instrumentation.ts` calls `logConfigChecklist()` from `lib/config.ts`, built on new `getConfigChecks()` (ok / missing / invalid / warning / skipped per setting). Also reports invalid `LIVE_PROVIDER` values (previously silently fell back to decart), rejected `APP_ORIGINS` entries (previously silently ignored), and missing `OBS_KEY` as a warning.
- [x] Never crashes: errors (including a broken `livebridge.config.ts`) are caught and printed as one clear line.
- [x] `/api/config/status` adds `invalid[]` (names only, never values). Studio banner and start error show missing + invalid with "then restart the server".

**Verify**
- [x] Normal `.env` → all ✓, "Ready for live sessions."
- [x] Shell overrides `LIVE_PROVIDER=falx`, blank `DECART_API_KEY`, `APP_ORIGINS=http://localhost:3000/,localhost:3000` → three ✗ lines with fixes; status `{configured:false, missing:[DECART_API_KEY], invalid:[LIVE_PROVIDER, APP_ORIGINS]}`.
- [x] `maxImageMb: -1` in `livebridge.config.ts` → server still starts, prints `[livebridge.config.ts] upload.maxImageMb must be ...`.

---

## Phase 5 — Dev loopback auto-allow (medium, security-sensitive)

**Why**: the preview proxy uses random ports, forcing `.env` edits (current workaround: `http://127.0.0.1:63740` in `APP_ORIGINS` and `allowedDevOrigins` in `next.config.ts`).

**Steps**
- [x] In `requireOrigin`, when `NODE_ENV !== "production"` **and** `dev.allowLoopbackOrigins` is true, accept `http://localhost:*` and `http://127.0.0.1:*` (exact hostname match via `new URL()`, no suffix tricks like `localhost.evil.com`). Added `dev.allowLoopbackOrigins` to `livebridge.config.ts`, `LiveBridgeConfig`, and validation.
- [x] Production keeps the exact `APP_ORIGINS` allowlist only (`isDevelopment()` gate).
- [x] Remove the temporary `http://127.0.0.1:63740` entry from `.env` after verifying.
- [x] Keep `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts` (needed for HMR/fonts) and add a comment explaining why.

**Verify**
- [x] Loopback origin matching is by exact `hostname` (`localhost`/`127.0.0.1`), so `localhost.evil.com`, `localhostx`, and `https://localhost` are rejected in dev — covered by code review of `isLoopbackOrigin`.
- [x] `pnpm build` passes; in production `isDevelopment()` is false so only `APP_ORIGINS` applies.
- [ ] Manual: preview on a random port not in `APP_ORIGINS` (not run — no preview session active).

---

## Phase 6 — UI resilience (easy)

**Steps**
- [x] `live-studio.tsx`: replaced silent `.catch(() => …)` on `/api/config/status` (red alert + Retry, status badge shows "Status check failed") and `/api/obs/link` (retry inside the OBS card).
- [x] Added `app/error.tsx` (Mantine UI + retry) and `app/global-error.tsx` (own `<html>/<body>`, inline styles) — Next 16 uses `retry`/`error: unknown` props per `error.md`.
- [x] `obs-viewer.tsx`: page stays blank for OBS; `logOnce()` logs a single console message per failure type (status HTTP errors, attach/subscribe failures, subscriber errors).

**Verify**
- [x] `pnpm typecheck` and `pnpm build` pass.
- [ ] Manual: stop server mid-session / temporary throw to exercise the boundary (not run — needs a live browser session).

---

## Phase 7 — Docs + cleanup (easy)

- [x] Update `README.md`: "Configure" section → `.env` for secrets, `livebridge.config.ts` for everything else; error code table with fixes.
- [x] Update `.env.example` (noted dev loopback behavior; standardized on `.env` everywhere — README no longer mentions `.env.local`).
- [x] Final `pnpm typecheck` and `pnpm build`.

---

## Progress log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-10-30 | — | Plan created. Temporary fixes in place: `allowedDevOrigins` in `next.config.ts`, preview origin in `.env`. |
| 2026-10-30 | 1 | Done. New: `livebridge.config.ts`, `lib/config-types.ts`, `lib/public-config.ts`, `lib/config.ts`. Removed: `app.config.ts`, `lib/server-config.ts`. |
| 2026-10-30 | 2 | Done. New: `lib/errors.ts`, `lib/api.ts`, `lib/api-client.ts`. All routes return `{ code, message, hint? }`. |
| 2026-10-30 | 3 | Done. New: `lib/upstream.ts`. Token routes map provider failures to auth/quota/unavailable/timeout with fixes. |
| 2026-10-30 | 4 | Done. New: `instrumentation.ts`; `getConfigChecks()` + `logConfigChecklist()` in `lib/config.ts`; status adds `invalid[]`. |
| 2026-10-30 | 5 | Done. `dev.allowLoopbackOrigins` in config; `isLoopbackOrigin` in `lib/api.ts`; removed temp preview origin from `.env`. |
| 2026-10-30 | 6 | Done. Retry alerts in `live-studio.tsx`; new `app/error.tsx` + `app/global-error.tsx`; per-type `logOnce` in `obs-viewer.tsx`. |
| 2026-10-30 | 7 | Done. README "Configure" + error code table; `.env.example` loopback note; `.env` (not `.env.local`) documented; typecheck + build pass. |
