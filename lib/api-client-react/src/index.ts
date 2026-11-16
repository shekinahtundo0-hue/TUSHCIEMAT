export * from "./generated/api";
export * from "./generated/api.schemas";
export { ApiError, setBaseUrl, setAuthTokenGetter, setSchoolIdGetter } from "./custom-fetch";
export type { AuthTokenGetter, SchoolIdGetter } from "./custom-fetch";
