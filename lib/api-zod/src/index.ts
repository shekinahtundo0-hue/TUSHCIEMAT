export * from "./generated/api";
export * from "./generated/types";

// Orval names the path-parameter zod schema and the whole-request params type the
// same thing when an operation has both. The zod schema is what server code validates.
export { ListAssignmentSubmissionsParams } from "./generated/api";
