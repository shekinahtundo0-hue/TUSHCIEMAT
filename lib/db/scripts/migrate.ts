import { runMigrations } from "../src/migrate";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error(
    "MIGRATION_DATABASE_URL is required. Use the schema-owner connection (Supabase direct or session pooler, port 5432), never the API role.",
  );
  process.exit(1);
}

await runMigrations(url);
console.log("Migrations are up to date.");
