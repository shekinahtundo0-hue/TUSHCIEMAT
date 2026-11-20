import type { Logger } from "pino";
import type { AppConfig } from "../config/env";
import type { Database } from "./database";
import type { IdentityVerifier } from "./identity";
import type { StorageAdapter } from "./storage";

export interface AppDeps {
  config: AppConfig;
  database: Database;
  identity: IdentityVerifier;
  logger: Logger;
  /** Absent until storage is configured; file endpoints answer 503 instead of pretending. */
  storage?: StorageAdapter | null;
}
