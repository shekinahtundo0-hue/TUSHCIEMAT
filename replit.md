# Tushciemat

Tushciemat is a multi-school platform for Kenyan education, connecting school operations, academic progress, finance, digital learning and tutoring.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run apply-policies` — apply tenant RLS and relationship checks
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/tushciemat` — responsive React app and school portals
- `artifacts/api-server` — shared Express API and authentication middleware
- `lib/api-spec/openapi.yaml` — API contract; regenerate clients after edits
- `lib/db/src/schema/schools.ts` — school, membership, class, student, attendance and audit models
- `lib/db/migrations/` — PostgreSQL tenant-isolation policies
- `docs/architecture.md` — relationships, permission matrix and rollout phases

## Architecture decisions

- Clerk owns user authentication; Tushciemat stores school memberships and enforces app roles on the server.
- PostgreSQL RLS supplements server authorization; protected transactions set the verified user and active school context.
- School-level data is never seeded with fabricated records or metrics.
- Payment and communication workflows require authorized provider integrations; initiated payments are not treated as confirmed.

## Product

The initial release establishes secure school onboarding, student and class records, and attendance. Future phases add exams, finance, parent/student learning, tutoring and platform operations.

## User preferences

- Product name: Tushciemat.
- Build in phases; do not present fake school data or claim unconfigured integrations are live.

## Gotchas

- Re-run API code generation after changing `lib/api-spec/openapi.yaml`.
- Apply the tenant-isolation SQL migration after pushing Drizzle schema changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
