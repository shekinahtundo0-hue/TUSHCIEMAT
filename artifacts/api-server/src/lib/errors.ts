import type { ZodType, ZodTypeDef } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, code = "invalid_request") =>
  new AppError(400, code, message);
export const unauthorized = (message = "Sign in is required.") =>
  new AppError(401, "unauthenticated", message);
export const forbidden = (message = "Your role does not allow this action.") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "That record was not found.") =>
  new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);

export function parseInput<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join(".");
  throw badRequest(
    field ? `${field}: ${issue.message}` : (issue?.message ?? "Invalid request."),
    "validation_failed",
  );
}

interface PgError {
  code: string;
  message: string;
  constraint?: string;
}

function isPgError(error: unknown): error is PgError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

/** Drizzle wraps driver errors (DrizzleQueryError); the Postgres error is on `cause`. */
export function pgErrorOf(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (isPgError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorOf(error)?.code === "23505";
}

// Messages raised by our own triggers and routines are written for end users;
// engine-generated messages (RLS, constraints) are replaced with neutral text.
function isEngineMessage(message: string): boolean {
  return /row-level security|permission denied|violates|constraint/i.test(message);
}

export function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  const pgError = pgErrorOf(error);
  if (!pgError) return null;
  const own = isEngineMessage(pgError.message) ? null : capitalize(pgError.message);

  switch (pgError.code) {
    case "23505":
      return conflict(own ?? "That record already exists.");
    case "23503":
      return badRequest("A referenced record does not exist.");
    case "23514":
      return badRequest(own ?? "The request breaks a data rule.");
    case "22P02":
    case "22023":
    case "22007":
    case "22008":
      return badRequest(own ?? "A value in the request is not valid.");
    case "42501":
      return forbidden(own ?? "You do not have permission to do that.");
    case "P0002":
      return notFound(own ?? "That record was not found.");
    case "57014":
      return new AppError(503, "timeout", "The database took too long to respond. Please try again.");
    default:
      return null;
  }
}

function capitalize(message: string): string {
  const text = message.trim();
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
