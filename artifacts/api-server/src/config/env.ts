export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  databaseCaCert: string | null;
  firebaseProjectId: string;
  corsAllowedOrigins: string[];
  trustProxy: number | false;
  timezone: string;
  invitationTtlDays: number;
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid server configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function pem(value: string | undefined): string | null {
  const raw = optional(value);
  return raw ? raw.replace(/\\n/g, "\n") : null;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  const required = (name: string): string => {
    const value = optional(env[name]);
    if (!value) problems.push(`${name} is required`);
    return value ?? "";
  };

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = optional(env[name]);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  };

  const port = integer("PORT", 0, 1, 65535);
  if (!optional(env.PORT)) problems.push("PORT is required");

  const databaseUrl = required("DATABASE_URL");
  const firebaseProjectId = required("FIREBASE_PROJECT_ID");
  if (firebaseProjectId && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)) {
    problems.push("FIREBASE_PROJECT_ID must be a Firebase project id (e.g. tushciemat-1a2b3)");
  }

  const corsAllowedOrigins = list(env.CORS_ALLOWED_ORIGINS);
  for (const origin of corsAllowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      problems.push(`"${origin}" is not an origin (expected scheme://host[:port])`);
    }
  }

  const trustProxyRaw = optional(env.TRUST_PROXY);
  let trustProxy: number | false = isProduction ? 1 : false;
  if (trustProxyRaw !== null) {
    if (trustProxyRaw === "false" || trustProxyRaw === "0") trustProxy = false;
    else {
      const hops = Number(trustProxyRaw);
      if (!Number.isInteger(hops) || hops < 1 || hops > 5) {
        problems.push("TRUST_PROXY must be false or the number of proxy hops (1-5)");
      } else trustProxy = hops;
    }
  }

  const timezone = optional(env.APP_TIMEZONE) ?? "Africa/Nairobi";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    problems.push(`APP_TIMEZONE "${timezone}" is not a valid IANA timezone`);
  }

  const config: AppConfig = {
    nodeEnv,
    isProduction,
    port,
    databaseUrl,
    databasePoolMax: integer("DATABASE_POOL_MAX", 10, 1, 100),
    databaseCaCert: pem(env.DATABASE_CA_CERT),
    firebaseProjectId,
    corsAllowedOrigins,
    trustProxy,
    timezone,
    invitationTtlDays: integer("INVITATION_TTL_DAYS", 7, 1, 30),
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
