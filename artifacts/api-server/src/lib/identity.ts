import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError, unauthorized } from "./errors";

/** Profile data taken only from a verified ID token, never from the request body. */
export interface VerifiedProfile {
  fullName: string | null;
  /** Present only when Firebase reports the address as verified. */
  email: string | null;
  imageUrl: string | null;
}

export interface VerifiedIdentity {
  userId: string;
  profile: VerifiedProfile;
}

export interface IdentityVerifier {
  verify(idToken: string): Promise<VerifiedIdentity>;
}

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const UID = /^[A-Za-z0-9_-]{1,128}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function profileFrom(payload: JWTPayload): VerifiedProfile {
  const email = text(payload.email);
  return {
    fullName: text(payload.name),
    email: email && payload.email_verified === true ? email.toLowerCase() : null,
    imageUrl: text(payload.picture),
  };
}

/**
 * Verifies Firebase Auth ID tokens against Google's published signing keys,
 * pinned to this project's issuer and audience. No service-account secret is needed.
 */
export function firebaseIdentityVerifier(
  projectId: string,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL)),
): IdentityVerifier {
  return {
    async verify(idToken) {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, keys, {
          issuer: `https://securetoken.google.com/${projectId}`,
          audience: projectId,
          algorithms: ["RS256"],
          clockTolerance: 5,
        }));
      } catch (error) {
        if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
          throw new AppError(503, "identity_unavailable", "We could not verify your sign-in right now. Please try again.");
        }
        throw unauthorized();
      }
      const authTime = typeof payload.auth_time === "number" ? payload.auth_time : NaN;
      if (!payload.sub || !UID.test(payload.sub) || !(authTime <= Date.now() / 1000 + 5)) {
        throw unauthorized();
      }
      return { userId: payload.sub, profile: profileFrom(payload) };
    },
  };
}
