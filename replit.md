# Tushciemat

Multi-school platform for Kenyan education. The authorized Clerk-to-Firebase
migration changes authentication, not authorization to deploy or modify Supabase.

## Local setup and commands

Copy the existing examples to gitignored `.env` files alongside them:

- `artifacts/tushciemat/.env.example` → `artifacts/tushciemat/.env`: public
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` from the Firebase web app.
- `artifacts/api-server/.env.example` → `artifacts/api-server/.env`: required
  `PORT` (example: 8080), `DATABASE_URL` (runtime `tushciemat_api` connection),
  `FIREBASE_PROJECT_ID=tushciemat-c4c14`; optional pool, CA, CORS, proxy, timezone
  and invitation-TTL settings are described in the example.

Commands below are verified against package scripts, not a claim of successful
execution or complete UI testing. Run from the repository root; keep DB, API and
Vite in separate terminals.

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Typecheck libraries, artifacts and scripts |
| `pnpm --filter @workspace/api-server run test` | Local API/RLS tests with embedded PostgreSQL and locally signed JWTs |
| `pnpm --filter @workspace/api-server run dev:db` | Start persistent local PostgreSQL (default 54329) and apply Drizzle migrations locally |
| `pnpm --filter @workspace/api-server run dev` | Build/start API; loads its `.env`, example port 8080 |
| `pnpm --filter @workspace/tushciemat run dev` | Vite, default port 5173; proxies `/api` to localhost:8080 |
| `pnpm run build` | Typecheck and build workspace packages |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate API clients and Zod schemas |

The local DB script prints runtime and owner URLs: keep them private, put only
the runtime URL in the API's `DATABASE_URL`, and never paste credentials into
documentation or browser config. Its data/credentials live under gitignored
`.local/dev-db`. Export `DEV_DB_PORT` for a DB port override; Vite's current config
reads `API_PROXY_TARGET` and `PORT` from process environment, so export them for
non-default proxy/port values (the example's proxy target matches the default).

## Migration authority and deployment boundary

Drizzle SQL migrations plus `lib/db/migrations/meta/_journal.json` are the sole
schema/RLS authority. Schema push and separate `apply-policies` are obsolete.
`pnpm --filter @workspace/db run migrate` requires an exported
`MIGRATION_DATABASE_URL` for the schema owner; it does not automatically load
the API `.env`, and the API does not use that owner variable. Owner/service
credentials must never reach browser bundles or documentation.

**Real Supabase migrations and deployment require separate explicit approval
and are NOT done.** Do not run migration commands against a real project under
this documentation-only task. The API uses the dedicated non-superuser
`tushciemat_api` role without BYPASSRLS, never an owner/service-role connection.

## Authentication and tenant decisions

- Firebase web email/password and Google replace Clerk; API authentication is
  Firebase ID bearer tokens, not cookies. Server `jose` verification uses Google's
  public keys, RS256 only, project-pinned audience and issuer
  `https://securetoken.google.com/<project-id>`. Firebase UID (`sub`) is identity.
- Transactions set `request.jwt.claims` locally with `sub`. Active school is
  selected by `X-School-Id`, checked against active memberships/roles within the
  transaction, then applied to query filters; no separate PostgreSQL school
  setting is currently set. RLS adds profile/role/relationship checks.
- Firebase project is `tushciemat-c4c14`, separate from `turiwa-app`. Configure
  authorized domains `localhost`, `127.0.0.1` and the deployment hostname, without
  schemes/ports. Public Firebase web config identifies the app; it grants no
  privileged access.
- Verification/reset use Firebase-hosted email actions. Invitations use copied
  links, not an integrated mail sender. There is no user lifecycle webhook or
  service secret; local profiles sync from verified claims on requests.
- Disabled/deleted Firebase accounts' issued tokens can last up to one hour:
  verification does not check revocation/account state. Non-active
  `user_profiles.status` immediately blocks subsequent protected requests.
- No billing upgrade is part of this migration. Standard email/password and
  Google Firebase Auth on Spark are no-cost within quotas; quotas matter, and
  SMS or paid infrastructure would add costs and require separate authorization.

## Stack and locations

- pnpm workspaces, Node.js 24, TypeScript; React/Vite/Wouter web app in
  `artifacts/tushciemat`, Express API with `jose` in `artifacts/api-server`.
- PostgreSQL/Drizzle schemas in `lib/db/src/schema/`; migrations in
  `lib/db/migrations/`; API builds with esbuild to `dist/index.mjs`.
- `lib/api-spec/openapi.yaml` defines the Orval-generated clients/Zod contracts;
  regenerate after edits. `docs/architecture.md` covers relationships and roles.

## Product and verification scope

Implemented: onboarding, invitations/acceptance/revocation, member role/status
management, academic years/terms, classes/teacher assignments, student/guardian
linking, attendance and linked parent/student portals. Finance, payments, AI,
exams, learning resources and tutor services remain future work. Initiated
payments are never treated as confirmed; unconfigured integrations are not live.

Local API/RLS tests do not prove live Firebase sign-in or all UI flows have been
tested. Keep the product name Tushciemat, build in phases and never fabricate
school records or metrics.
