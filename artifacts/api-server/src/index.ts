import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/env";
import { createDatabase, createPool } from "./lib/database";
import { firebaseIdentityVerifier } from "./lib/identity";
import { logger } from "./lib/logger";

function start(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.fatal(error.message);
      process.exit(1);
    }
    throw error;
  }

  const pool = createPool({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    caCert: config.databaseCaCert,
  });
  pool.on("error", (error) => logger.error({ err: error }, "Idle database client error"));

  const database = createDatabase(pool);
  const app = createApp({ config, database, identity: firebaseIdentityVerifier(config.firebaseProjectId), logger });

  const server = app.listen(config.port, (error) => {
    if (error) {
      logger.fatal({ err: error }, "Could not listen on the configured port");
      process.exit(1);
    }
    logger.info({ port: config.port, env: config.nodeEnv }, "Server listening");
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
