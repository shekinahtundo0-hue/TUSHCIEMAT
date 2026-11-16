#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Database migrations are never applied automatically. Run them deliberately:
#   MIGRATION_DATABASE_URL=... pnpm --filter @workspace/db run migrate
