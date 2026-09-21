# Backend Connection Plan: Hosted / Self-Hosted / Custom + Future Storage Providers

Status: **plan only — no code changed**.
Scope: mobile app repo (`podcast-me`, Expo SDK 57) + existing backend repo (`web`, Next.js 16.3.5).

This plan is grounded in the code as it exists today. It prefers the simplest
production-ready architecture that stays extensible.

---

## 1. Current architecture (verified)

### 1.1 Backend (`web/`)

- **Framework:** Next.js 16.3.5 + React 19. Versioned mobile API under
  `app/api/v1/`:
  - `POST /auth/otp/request`, `POST /auth/otp/verify`
  - `POST /auth/refresh`, `POST /auth/logout`
  - `GET /me`
  - `GET /audios`, `POST /audios` (Spotify URL save)
  - `POST /audios/uploads`, `POST /audios/uploads/{uploadId}/complete`
  - `GET|PATCH|DELETE /audios/{id}`
  - `GET /audios/{id}/stream`, `GET|PUT /audios/{id}/playback`
  - `GET /api/v1/openapi.json` (OpenAPI 3.1, currently `info.version: 1.1.0`)
- **Docs:** `docs/mobile-api.md` is the de-facto mobile contract; root `README.md`
  documents R2 CORS, YouTube cookies, migrations.
- **Auth (`lib/auth.ts`):**
  - Email OTP (6-digit, 10-min expiry, 5 attempts, 60s resend cooldown).
  - Dev: code printed to server log. Prod: Resend (`RESEND_API_KEY`,
    `RESEND_FROM_EMAIL`).
  - Web = 30-day cookie (`hushline_session`). Mobile = 15-min access token +
    30-day refresh token, rotation invalidates old refresh immediately,
    `refreshExpiresAt` is absolute.
  - Tokens are HMAC-SHA256 hashes (`AUTH_SECRET`); only hashes stored in DB.
  - Rate limits are DB-backed (`rate_limits` table), shared across instances.
- **DB (`db/schema.ts`, `db/index.ts`, `drizzle/`, `scripts/migrate.ts`):**
  - SQLite via Drizzle + `@libsql/client`.
  - Dev/local: `DATABASE_URL=file:./hushline.db`.
  - Prod today: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` required when
    `NODE_ENV=production` (hard requirement in `db/index.ts`).
  - Migrations: `npm run db:generate` → `npm run db:migrate`
    (`drizzle-orm/libsql/migrator`, folder `drizzle/sqlite`).
    Vercel prod runs `db:migrate` in `vercel-build`.
  - Tables: `users`, `otp_codes`, `sessions`, `rate_limits`, `audios`,
    `playback_progress`, `listening_events`.
- **Audio pipeline (`lib/audio-service.ts`, `utils/audio_getter.ts`, `utils/r2.ts`):**
  - Spotify track/episode → Spotify API → YouTube match via `yt-dlp` →
    transcode via `fluent-ffmpeg` (wrapper only, needs real `ffmpeg` binary) →
    upload MP3 to Cloudflare R2 → `audios` row with `storageKey`.
  - Local-file uploads: two-step direct-to-R2 presigned `PUT`
    (`createAudioUploadUrl`, 10-min TTL), then `complete` verifies
    byte-length + content-type via `HeadObject`, parses tags with
    `music-metadata`, inserts row with quota recheck.
  - Streaming: absolute presigned R2 `GET` (~60 min TTL) fetched **without**
    bearer header; relative `streamUrl` = same-origin proxy fallback (bearer
    required, follows `302` to R2 for R2-backed rows).
  - Quotas: non-admin 6 active audios, 2 saves/day (UTC).
  - `yt-dlp` binary is **downloaded at runtime** from GitHub releases into
    `tmpdir()/hushline/.bin/` unless `YT_DLP_PATH` is set
    (`utils/audio_getter.ts#getYtDlpBinaryPath`). Needs egress + writable +
    executable tmp.
  - YouTube bot-check workaround: multiline `YT_DLP_COOKIES` env (Netscape
    format), written to temp file per call. Not guaranteed on datacenter IPs.
- **Env today (`.env.example`):**
  `DATABASE_URL`, `TURSO_*`, `AUTH_SECRET`, `RESEND_*`, `AUDIO_ROOT`,
  `R2_ACCOUNT_ID/ACCESS_KEY/SECRET/BUCKET`, `R2_ALLOWED_ORIGINS`,
  `SPOTIFY_CLIENT_ID/SECRET`, `YT_DLP_COOKIES`, implicit `YT_DLP_PATH`.
- **Hosting today:** Vercel (`vercel.json` → `npm run vercel-build` =
  migrate + `r2:cors` + `next build`). No `Dockerfile`, no health endpoint,
  no `/api/v1/meta`.

### 1.2 Mobile app (`podcast-me/`)

- **Config:** `EXPO_PUBLIC_API_ORIGIN` is a **build-time** constant
  (e.g. `https://podcastme.m14.pro`). `src/services/api.ts#getApiOrigin()`
  reads it, strips trailing `/`, appends `/api/v1${path}`. Missing value →
  `ApiError('Sign-in is not configured for this app build.')`.
  `app.config.js` also copies it to `extra.apiOrigin`.
- **API client (`src/services/api.ts`):** thin `fetch` wrapper, JSON errors
  `{error:{code,message}}`, `204` → `undefined`. Stream helper
  `buildRemoteAudioStreamSource()` attaches `Authorization` only for
  same-origin URLs; presigned R2 URLs get clean headers. Correct — keep.
- **Session (`src/services/auth-session-storage.ts`, `src/contexts/auth-context.tsx`):**
  - Single global `Session` (`accessToken`, `refreshToken`, `expiresAt`,
    `refreshExpiresAt`, `user`) in key `podcast-me.auth-session.v1`
    (SecureStore native, AsyncStorage web).
  - `AuthContext` handles expiry check, single-flight refresh, retry-once on
    401, logout revocation, per-user remote-audio caches + Android Auto catalog
    push.
  - Assumption everywhere: **one backend, one session**.
- **UI:** `src/app/profile.tsx#AccountCard` = OTP email→code flow. No backend
  picker, no URL input, no connection test, no per-backend isolation.

### 1.3 Key gaps for this task

1. No runtime backend switching (origin is baked at build).
2. No compatible-backend discovery/version check.
3. No Docker packaging; prod DB path forces Turso; R2 is effectively mandatory.
4. No storage abstraction (R2 calls are direct in `utils/r2.ts` +
   `lib/audio-service.ts`).
5. No per-user OAuth storage (Drive/Dropbox) model.

---

## 2. Goals and non-goals

Goals:

- One app binary connects to (a) hosted cloud, (b) self-hosted Docker of the
  same backend, (c) any compatible custom backend, chosen at runtime.
- Self-hosting is `docker compose up` simple, with documented env, volumes,
  upgrades.
- API stays compatible via explicit versioning; old apps fail with a clear
  message, not silent corruption.
- Future Drive/Dropbox fits behind a `StorageProvider` interface without
  rewriting upload/stream paths.

Non-goals (for this plan):

- Multi-account simultaneous sync, federation, or backend-to-backend migration.
- Rewriting auth (keep OTP + bearer) or replacing R2 as the default object
  store.
- Web UI multi-backend support (web remains single-deployment; only the mobile
  app switches).

---

## 3. Backend selection model (mobile app)

### 3.1 Concepts

```ts
type BackendKind = 'hosted' | 'self-hosted' | 'custom';

type BackendConfig = {
  id: string;            // stable: 'hosted' | `custom:<hash(origin)>`
  kind: BackendKind;
  label: string;         // "Podcast Me Cloud", "Home server", custom host
  baseUrl: string;       // origin only, e.g. https://podcast.example.com
  apiVersion?: string;   // last verified server apiVersion, e.g. "1.1.0"
  lastCheckedAt?: string;
};
```

- `hosted` = our operated URL(s). Ship a built-in default
  (today `https://podcastme.m14.pro`; keep `EXPO_PUBLIC_API_ORIGIN` as the
  **default**, not the only value).
- `self-hosted` and `custom` are technically identical (user-supplied origin);
  keep two labels for UX clarity: "self-hosted" implies "our backend in
  Docker", "custom" implies "any compatible implementation". Store both as
  `kind` for analytics/support but treat identically in code.
- One active backend at a time. Sessions, caches, playback-device id scope,
  and Android Auto snapshot are all **keyed by `BackendConfig.id`**.

### 3.2 Where state lives

- `backend-config-storage.ts` (new): `AsyncStorage` (not SecureStore — it is
  not secret) keys:
  - `podcast-me.backend-config.v1`: active `BackendConfig`.
  - `podcast-me.backend-history.v1`: last N (e.g. 5) custom origins for quick
    re-pick.
- Sessions move to per-backend keys:
  `podcast-me.auth-session.v1:<backendId>`. Migration: on first launch, move
  legacy `podcast-me.auth-session.v1` → hosted id entry, then delete legacy.
- Remote-audio metadata/file caches already key by `user.id`; extend key to
  `${backendId}:${user.id}` so switching backends never leaks library A into
  library B. Same for `collection-order-storage` scope (today `user.id ??
  'device'` → `${backendId}:${user.id ?? 'device'}`).

### 3.3 Switching semantics

- Switching backend = implicit sign-out of the previous backend **locally**
  (revoke on server best-effort, then clear in-memory session + caches for
  that backend id; do **not** delete the stored session of the old backend so
  switching back restores it — or delete? Decision: **keep** stored sessions
  per backend, but require explicit Sign out to revoke. Simpler and expected).
- After switch: reset `loadRemoteAudios` memo refs, clear Android Auto catalog
  (`syncAndroidAutoRemoteLibrary('[]')`), reload profile + library from new
  origin.
- All `src/services/api.ts` functions take an explicit `baseUrl` (or an
  `ApiClient` instance bound to it) instead of reading the global env.
  `AuthContext` holds the active client; `getApiOrigin()` becomes
  `getActiveBackendOrigin()` with fallback to build default.

### 3.4 Connection flow (custom / self-hosted URL)

1. User opens Profile → Account → "Backend" row (shows current label + host).
2. Screen `app/backend.tsx` (new, expo-router): segmented choice
   `[Hosted | Self-hosted | Custom]` + explanation text.
   - Hosted: single button "Use Podcast Me Cloud".
   - Self-hosted/Custom: URL `TextInput` with placeholder
     `https://podcast.example.com`, plus "Scan QR" later (optional, not v1).
3. On submit:
   - **Normalize:** trim, lowercase host, add `https://` if scheme missing,
     strip trailing `/`, reject paths (`/api/v1` suffix stripped with warning),
     reject `http://` except RFC 1918/`localhost` with explicit "insecure
     LAN" confirm (needed for dev against `http://192.168.x.x:3000`).
   - **Probe:** `GET {origin}/api/v1/meta` (new, §5.1; no auth), 8–10s timeout,
     show spinner. Fallback if `meta` missing (old server): `GET
     {origin}/api/v1/openapi.json` and infer version.
   - **Validate:** HTTPS (or allowed LAN exception), `apiVersion` within
     app-supported range (§5.2), `capabilities` includes required features
     (`otp`, `uploads`, `stream`). On mismatch show exact message
     ("Server API 2.0.0 needs app ≥ 1.5.0 — update the app" /
     "Server too old (0.9.0) — upgrade your backend").
   - **Save** `BackendConfig`, set active, navigate back to Account, start OTP
     flow against new origin.
4. Persist last error per origin to aid troubleshooting (e.g. TLS, timeout,
   404 = "not a Podcast Me backend").

No QR/deep-link in v1; reserve `podcastme://backend?url=` scheme for later.

---

## 4. Authentication and security

Keep OTP + short-lived bearer as-is; changes are about **isolation and
hardening for untrusted URLs**:

1. **Per-backend token isolation.** Never send backend A's token to backend B.
   Binding the `ApiClient` to `baseUrl` + namespacing SecureStore keys (§3.2)
   achieves this. Audit every `fetch(upload.uploadUrl)`: R2 presigned URLs
   already exclude bearer — keep that invariant and extend to future
   provider URLs (Drive/Dropbox download URLs must also get clean headers).
2. **HTTPS by default.** Accept `http://` only for `localhost`, `127.0.0.1`,
   `10/8`, `172.16/12`, `192.168/16`, `.local`; show scary-but-clear confirm.
   Never allow tokens in query strings (already true; add a test).
3. **Untrusted-server UX.** Custom backend sees the user's email (OTP) and
   their audio. Copy must say: "Only connect to servers you trust. Your email
   and library are visible to that server's operator." Link to self-host docs.
4. **Server-side, no auth-model change, but required hardening for
   self-hosters:**
   - `AUTH_SECRET`: required at container start (fail fast if default/missing;
     generate docs command `openssl rand -base64 48`). Document rotation =
     invalidates all sessions (expected).
   - `RESEND_API_KEY` required in prod; dev-mode code-in-response/log must
     **never** activate when `NODE_ENV=production` (already the case — add a
     startup assertion + test).
   - Keep DB-backed rate limits (works multi-instance); document adding
     reverse-proxy limits (Caddy/Nginx `limit_req`) for OTP endpoints.
   - `R2_ALLOWED_ORIGINS` must include the self-hosted web origin if browser
     uploads are used; native needs none.
   - `YT_DLP_COOKIES` is a user-session secret: never log, never return via
     API; Docker secret/file support (`*_FILE` convention, §6.3).
5. **App transport:** pin nothing in v1 (custom hosts break pinning); rely on
   OS TLS. Add 10s timeouts + single retry only for idempotent GETs; never
   auto-retry OTP verify/refresh (rotation + attempt counters make replays
   harmful — current single-retry-once logic stays).

---

## 5. API compatibility / versioning

### 5.1 New contract endpoint (backend change, small)

Add unauthenticated `GET /api/v1/meta` (and keep serving `openapi.json`):

```json
{
  "name": "podcast-me-backend",
  "apiVersion": "1.1.0",
  "minAppVersion": "1.0.19",
  "capabilities": ["otp", "uploads", "stream", "playback"],
  "storage": ["r2"],
  "serverVersion": "0.4.2"
}
```

- `apiVersion` = OpenAPI `info.version`, bumped on any breaking mobile-API
  change. Single source of truth: `docs/openapi.json` → `meta` reads it.
- `serverVersion` = backend image/app version (from `APP_VERSION` env or
  `package.json`), for support + upgrade prompts. Informational only.
- `storage` advertises configured providers (`r2`, later `drive`, `dropbox`,
  `local`). App disables upload affordances for unconfigured providers with a
  clear message instead of a bare 500.

Also add `GET /api/v1/health` (or `/api/health`): `{ok:true}` for Docker
`HEALTHCHECK` + load balancers. No DB query (or trivial `SELECT 1` variant
`?deep=1` — keep simple: liveness only, readiness = migrate success at boot).

### 5.2 Versioning rules

- **Semver for `apiVersion`:** breaking = remove/rename route, change auth,
  change error envelope, change pagination/stream semantics → major.
  Additive (new optional field, new capability, new `storage` value) → minor.
- **App policy:** app ships `SUPPORTED_API_RANGE = ">=1.0.0 <2.0.0"` (initial).
  On probe: `major` mismatch → block with upgrade message; `minor` newer than
  app knows → connect with warning ("some features may be unavailable").
  Older server within range → connect.
- Every mobile request sends `User-Agent: PodcastMe/<appVersion>` and
  `X-App-Version`. Server logs it; future enforcement point.
- Existing `npm test` contract tests (OpenAPI validation/route coverage) run
  in CI for every backend change; add `meta` + `health` to that suite.
- Web routes outside `/api/v1` are explicitly **not** part of the contract
  (already stated in OpenAPI description — keep).

---

## 6. Docker packaging for the existing backend

### 6.1 Image design (simplest production-ready)

- **Base:** `node:22-bookworm-slim` (LTS; matches dev Node 24? pin one LTS —
  recommend 22 for `better-sqlite3` prebuilds; verify in Phase 1).
  Multi-stage:
  1. `deps`: `npm ci` (needs python3/make/g++ for `better-sqlite3` — install
     `build-essential python3` here only).
  2. `builder`: `npm run build` (`next build`, standalone output — requires
     `output: 'standalone'` in `next.config.ts`, §8.1).
  3. `runner`: slim, `ffmpeg` + `python3` (yt-dlp runtime dep for some
     extractors) + pre-baked `yt-dlp` binary via `YT_DLP_PATH=/usr/local/bin/yt-dlp`
     (download at build with checksum; removes runtime GitHub dependency and
     tmp-exec requirement). Non-root `nodejs:nextjs` user. Copy
     `.next/standalone`, `.next/static`, `public`, `drizzle/` (migrations),
     `scripts/migrate.*`.
- **Entrypoint (`docker/entrypoint.sh`):** run `npm run db:migrate`
  (libsql file or Turso), then `exec node server.js`. Fail fast on missing
  `AUTH_SECRET`. Optional `r2:cors` only if `R2_CONFIGURE_CORS=true`
  (default false — self-hoster runs it manually once).
- **Port:** `3000` (`HOSTNAME=0.0.0.0`, `PORT=3000`). `HEALTHCHECK CMD
  node -e "fetch('http://127.0.0.1:3000/api/v1/health')..."` or wget.
- **Arch:** build `linux/amd64` + `linux/arm64` (self-hosters on Mac mini/RPi).
  `ffmpeg` via apt (`ffmpeg` package) covers both; yt-dlp binary per-arch.
- **Tagging:** `podcastme/backend:<serverVersion>`, plus `latest` and
  `stable`. Never use `latest` in compose examples — pin versions.

### 6.2 Compose (reference deployment)

`docker-compose.yml` (shipped in backend repo, copied into docs):

```yaml
services:
  backend:
    image: podcastme/backend:0.4.2
    restart: unless-stopped
    ports: ["3000:3000"]
    env_file: [.env]
    volumes:
      - podcastme-data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)})"]
      interval: 30s
      timeout: 5s
      retries: 3
volumes:
  podcastme-data:
```

- Reverse proxy (TLS) is **expected but separate**: Caddy example
  (`reverse_proxy backend:3000`, automatic Let's Encrypt) in docs; app
  requires the public `https://` origin.
- Single container = SQLite file. No Postgres, no Redis (rate limits already
  in-DB — a deliberate simplicity win; document it).

### 6.3 Environment variables (Docker contract)

| Var | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | yes (prod) | long random; container refuses to boot without it |
| `DATABASE_URL` | no, default `file:/app/data/hushline.db` | file path **must** be under the volume; `TURSO_*` alternative for managed DB |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | only if using Turso | replaces file DB; volume then only holds tmp/audio scratch |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | yes (prod OTP email) | without it prod OTP cannot send; dev-log fallback disabled in prod |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | yes for uploads/Spotify saves | same as today; document creating a private bucket |
| `R2_ALLOWED_ORIGINS` | if web uploads used | self-hosted web origin + localhost |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | without: Spotify-URL saves return clear "not configured"; uploads still work |
| `YT_DLP_COOKIES` | optional | YouTube bot workaround; support `YT_DLP_COOKIES_FILE` (Docker secret) |
| `YT_DLP_PATH` | baked in image | override only for custom builds |
| `AUDIO_ROOT` | legacy local path; keep default, unused when R2 set | future `local` storage provider reuses `/app/data/audio` |
| `APP_VERSION` | set at build | surfaced in `/api/v1/meta#serverVersion` |
| `R2_CONFIGURE_CORS` | default false | opt-in auto CORS at boot |

Support `*_FILE` for every secret (`AUTH_SECRET_FILE`, etc.) so Docker Swarm/
secret mounts work; entrypoint resolves them.

### 6.4 Persistence, networking, expectations

- **Persist:** `/app/data` (SQLite file, future local audio, yt-dlp scratch
  if not tmpfs). Back up `hushline.db` (SQLite backup / file copy while
  stopped or `sqlite3 .backup`). R2 objects are **not** in the volume —
  document bucket versioning/lifecycle separately.
- **Ephemeral:** Next.js cache, `TMPDIR` downloads/transcodes (size: peak ~2×
  largest audio; document 2 GB free minimum).
- **Network out:** Spotify API, YouTube, iTunes lookup, R2 endpoint, Resend
  API, GitHub (only if not using baked yt-dlp — avoid). Document egress
  allowlist for locked-down hosts.
- **Resources:** 512 MB RAM minimum, 1 GB recommended (transcode spikes);
  1 vCPU fine; no GPU.
- **No auto-migrations surprise:** entrypoint migrates with Drizzle journal
  (backwards-compatible migrations only; destructive ones get a major
  `serverVersion` + manual-upgrade note).

### 6.5 Upgrades (self-hosted)

Standard path (documented verbatim in ops guide):

1. Back up: `docker compose exec backend sqlite3 /app/data/hushline.db
   ".backup /app/data/backup-$(date +%F).db"` (or stop + copy volume).
2. Bump pin in `docker-compose.yml`: `image: podcastme/backend:0.4.3`.
3. `docker compose pull && docker compose up -d`.
4. Entrypoint auto-runs `db:migrate`; `docker compose logs -f backend` should
   show "Database migrations applied." + version line.
5. Verify: `curl https://host/api/v1/meta` → expected `apiVersion`.

Rules: patch/minor = auto-migrate, no action. Major = release notes may
require manual step (never auto-destructive). Rollback = re-pin previous tag
+ restore backup (migrations are forward-only; document that downgrade
without backup restore is unsupported). Add `UPGRADE.md` changelog per
release.

---

## 7. Future storage providers (Drive / Dropbox / …)

### 7.1 Abstraction (backend)

Introduce `StorageProvider` interface **before** adding any new vendor, and
refactor `utils/r2.ts` into `storage/r2.ts` implementing it:

```ts
interface StorageProvider {
  name: 'r2' | 'local' | 'drive' | 'dropbox';
  createUploadGrant(args: { ownerId, uploadId, ext, contentType, size }): Promise<UploadGrant>;
  verifyUpload(key): Promise<{ size, contentType }>;
  createDownloadUrl(key, opts): Promise<string>;  // presigned / proxied
  getRange(key, range): Promise<AudioBytes>;      // current getAudioFromR2
  delete(key): Promise<void>;
  deleteUserPrefix(ownerId): Promise<void>;       // GDPR delete
}
```

- `audios.storageKey` becomes `provider:key` (e.g. `r2:audio/...`,
  `drive:<fileId>`); add `storage_provider` column via migration (backfill
  `r2` for existing non-null keys; null stays provider-less legacy).
- Factory `getStorageProvider(name)` reads per-deployment defaults
  (`STORAGE_DEFAULT=r2|local`) + per-audio prefix. Self-hosters without R2 get
  a working `local` provider (files under `/app/data/audio`, streamed via the
  same-origin proxy — no presigned URLs, bearer required). This is what makes
  "docker without Cloudflare" viable.
- Keep the two-step grant→PUT→complete flow for **all** providers; only the
  `uploadUrl` target changes (R2 presigned URL vs backend-relayed TUS/chunked
  endpoint for vendors without direct PUT).

### 7.2 Drive / Dropbox specifics (later phase, design reserved now)

- **Auth model:** per-user OAuth2. New tables `storage_accounts
  (user_id, provider, refresh_token_enc, scope, email, expires_at)` +
  `AUDIO_*` rows reference them. Tokens encrypted at rest (AES-GCM with
  `STORAGE_TOKEN_KEY`, **separate** from `AUTH_SECRET`); never log; refresh on
  401 via provider token endpoint.
- **OAuth dance:** backend owns `GDRIVE_CLIENT_ID/SECRET`,
  `DROPBOX_CLIENT_ID/SECRET`; app opens system browser (`expo-web-browser`)
  to `{backend}/api/v1/storage/{provider}/authorize?device=...` →
  redirect back `podcastme://storage-callback` → backend stores tokens,
  app polls `GET /storage/{provider}/status`.
- **Semantics:** Drive/Dropbox hold **source blobs** (user's folder
  `PodcastMe/`); library metadata + playback positions stay in our DB
  (single source of truth for resume). Stream via provider download URL
  (short-lived, clean headers) or backend `302`; offline cache unchanged
  (already provider-agnostic file cache).
- **Quotas/limits:** provider quota errors map to `storage_quota_exceeded`
  (new error code, 507) distinct from library limits.
- **Order:** `local` provider first (unblocks R2-less self-host), then Drive,
  then Dropbox. Each behind `capabilities`/`storage` advertisement in `meta`
  so the app can hide what the server lacks.

---

## 8. Required changes

### 8.1 Backend repo (`web/`)

1. `next.config.ts`: `output: 'standalone'` (+ keep `images.remotePatterns`).
2. `GET /api/v1/meta` + `GET /api/v1/health` routes; `meta` reads
   `docs/openapi.json#info.version`; add both to contract tests.
3. `db/index.ts`: allow file DB in production when `TURSO_*` absent
   (default `file:/app/data/hushline.db`); keep Turso path. Env-driven, no
   code forks per host.
4. Startup assertions: `AUTH_SECRET` set in prod; dev-OTP fallback refuses in
   prod; log `serverVersion` + `apiVersion` + storage providers on boot.
5. `Dockerfile` (multi-stage, ffmpeg + baked yt-dlp, non-root),
   `.dockerignore`, `docker/entrypoint.sh`, `docker-compose.yml`,
   `.env.selfhost.example` (copy of §6.3 with comments).
6. CI: build + push multi-arch image on tags; run `npm test` + Docker smoke
   (`compose up`, `meta`/`health`, migrate idempotency).
7. Storage refactor: `utils/r2.ts` → `storage/` interface + `r2` impl +
   `local` impl; `storageKey` prefixing; `storage` in `meta`.
   (Drive/Dropbox OAuth in a later milestone, but tables/interface land here.)
8. Send `User-Agent`/`X-App-Version` awareness (log only, v1).

### 8.2 Mobile app repo (`podcast-me/`)

1. `src/services/backend-config.ts` (new): `BackendKind/BackendConfig`,
   normalize/validate URL, `probeBackend(origin)` (`meta` → `openapi.json`
   fallback), version-range check, history.
2. `src/services/api.ts`: replace global `getApiOrigin()` with injectable
   client (`createApiClient(baseUrl)`); every exported function takes client
   or uses the active one from context. Keep `buildRemoteAudioStreamSource`
   header rule; generalize "same-origin?" check to "active-backend-origin?".
3. `src/services/auth-session-storage.ts`: per-backend keys + legacy
   migration.
4. `src/contexts/auth-context.tsx`: hold `activeBackend`; expose
   `backend`, `setBackendAndReset()`, `probeBackend()`; re-key caches
   (`remote-audio-cache`, `remote-audio-file-cache`, collection order) by
   backend id; Android Auto reset on switch.
5. New `app/backend.tsx` + AccountCard "Backend" row showing
   `{label} · {host}`; connection-error copy per §3.4; insecure-LAN confirm.
6. `app.config.js`/`eas.json`: keep `EXPO_PUBLIC_API_ORIGIN` as **default
   hosted URL**; document per-channel overrides (dev → staging host).
7. Tests: URL normalization, probe accept/reject matrix, per-backend session
   isolation, no-bearer-on-presigned-URL (extend to generic cross-origin).

---

## 9. Phases and step-by-step tasks

**Phase 0 — Contract (1–2 days, backend+app, no Docker yet)**
- [ ] Add `/api/v1/meta` + `/api/v1/health`; wire `apiVersion` to
  `docs/openapi.json`; extend `npm test`.
- [ ] Send `User-Agent`/`X-App-Version` from app; log server-side.
- [ ] Freeze `SUPPORTED_API_RANGE` + compatibility copy in app.

**Phase 1 — Dockerize backend (2–4 days)**
- [ ] `output:'standalone'`, `Dockerfile`, `.dockerignore`, `entrypoint.sh`
  (migrate-then-serve, `*_FILE` secrets, fail-fast checks), `compose` file,
  `.env.selfhost.example`.
- [ ] Bake `ffmpeg` + per-arch `yt-dlp` (`YT_DLP_PATH`); verify Spotify save +
    upload + stream inside container.
- [ ] `db/index.ts` file-in-prod support; volume-backed default path.
- [ ] Multi-arch build (`amd64/arm64`), tag scheme, CI publish on git tags.
- [ ] Smoke test: fresh `compose up` → register OTP (dev code) → upload →
    stream → restart → data persists.

**Phase 2 — App multi-backend (3–5 days)**
- [ ] Backend-config storage + probe + normalize (unit-tested).
- [ ] `api.ts` client injection; per-backend sessions; cache re-keying.
- [ ] `app/backend.tsx` UI + Profile integration + LAN-http confirm.
- [ ] E2E: hosted → custom → hosted switching keeps both sessions; wrong URL,
    old server, new server cases show correct copy.
- [ ] Release behind no flag (additive; default = today's hosted origin).

**Phase 3 — Storage abstraction (1–2 weeks, after 0–2 shipped)**
- [ ] `StorageProvider` interface; move R2; add `local` provider; prefix keys;
    advertise in `meta`.
- [ ] Self-host-without-R2 path verified (uploads + proxy streaming).
- [ ] Schema reserved for `storage_accounts` (OAuth tokens); Drive spike next.

**Phase 4 — Docs + release (parallel with 2–3)**
- [ ] Docs listed in §10; `UPGRADE.md` process; version the compose pin.
- [ ] Publish image, announce custom-backend support, close the loop with
    troubleshooting from real self-host reports.

---

## 10. Documentation to write (when implementing, not now)

1. **`docs/self-hosting.md` (backend repo):** requirements (Docker, 1 GB RAM,
   public `https://` origin via Caddy/Nginx example), `compose up` quickstart,
   full env-var table (§6.3), first-run (OTP email), R2 bucket setup + CORS,
   Spotify/YouTube optionals, backups, logs, resource sizing.
2. **`docs/upgrades.md` / `UPGRADE.md`:** pin-bump flow, backup command,
   migrate expectations, major-version notes, rollback (re-pin + restore).
3. **`docs/connect-app.md` (app docs/help):** Hosted vs Self-hosted vs Custom
   explainer, trust warning, URL entry + probe errors with screenshots,
   LAN/`http` dev note, switching/sign-out semantics, "server too old/new"
   messages.
4. **`docs/troubleshooting.md`:** matrix — 404 on probe (not a backend / wrong
   path), TLS errors, timeout (firewall), 429 (rate limits), OTP never arrives
   (Resend/DNS/SPF), presigned-URL failures (clock skew, R2 keys, CORS for
   web), YouTube bot error (cookies/host IP), ffmpeg missing (custom builds),
   DB locked/Turso errors, version mismatch.
5. **`docs/storage-providers.md`:** R2 vs local vs (future) Drive/Dropbox,
   per-provider setup, OAuth consent-screen steps when shipped, token
   encryption/rotation, quota-error meanings.
6. **Reference files:** `docker-compose.yml` (pinned tag), `.env.selfhost.example`,
   Caddyfile example, `openapi.json` changelog per `apiVersion` bump.

---

## 11. Open decisions (resolve before Phase 2 build)

1. Hosted production origin(s): keep `podcastme.m14.pro` or introduce
   `api.podcast.me`? (Affects default + docs.)
2. Keep per-backend stored sessions on switch (recommended) vs wipe? 
3. Minimum supported `apiVersion` at launch: `>=1.0.0 <2.0.0` with current
   `1.1.0` — confirm no breaking drift before tagging first image.
4. Local-storage provider: include in first Docker release (recommended yes —
   makes R2 optional) or require R2 initially?
5. Image registry + naming (`ghcr.io/…` vs Docker Hub `podcastme/backend`).

---

## 12. Acceptance criteria for the whole effort

- Fresh laptop → `docker compose up` → app pointed at LAN/`https` origin →
  OTP sign-in → upload → stream → restart → library persists.
- Same app build talks to hosted cloud and to local Docker by switching in
  Profile, with sessions isolated and no token leakage (verified by test +
  manual proxy check).
- Incompatible server versions are blocked with actionable copy, not crashes.
- Upgrade = backup + pin bump + `pull/up`, verified via `meta`.
- Adding Drive later touches only `storage/` + OAuth routes + app browser
  step — no changes to playback-position, library, or cache layers.
