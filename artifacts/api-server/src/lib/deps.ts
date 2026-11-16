import type { Logger } from "pino";
import type { AppConfig } from "../config/env";
import type { Database } from "./database";
import type { IdentityVerifier } from "./identity";

export interface AppDeps {
  config: AppConfig;
  database: Database;
  identity: IdentityVerifier;
  logger: Logger;
}
