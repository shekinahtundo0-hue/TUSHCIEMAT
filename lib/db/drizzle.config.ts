import { defineConfig } from "drizzle-kit";

// Migrations run as the schema owner; the API's DATABASE_URL is the least-privilege tushciemat_api role.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  strict: true,
  verbose: true,
});
