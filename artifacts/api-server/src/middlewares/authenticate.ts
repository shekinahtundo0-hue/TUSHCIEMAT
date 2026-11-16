import type { RequestHandler, Response } from "express";
import type { UserProfile } from "@workspace/db/schema";
import type { AppDeps } from "../lib/deps";
import { unauthorized } from "../lib/errors";
import type { VerifiedProfile } from "../lib/identity";
import { ensureProfile } from "../modules/account/service";

declare global {
  namespace Express {
    interface Locals {
      verifiedProfile?: VerifiedProfile;
    }
  }
}

const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;

/** Requires a verified Firebase ID token and an active local profile. */
export function authenticate(deps: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const token = BEARER.exec(req.get("authorization") ?? "")?.[1];
    if (!token) throw unauthorized();
    const { userId, profile } = await deps.identity.verify(token);
    res.locals.userId = userId;
    res.locals.verifiedProfile = profile;
    res.locals.profile = await ensureProfile(deps, userId, profile);
    next();
  };
}

export function currentProfile(res: Response): UserProfile {
  const profile = res.locals.profile;
  if (!profile) throw unauthorized();
  return profile;
}

export function currentVerifiedProfile(res: Response): VerifiedProfile {
  const profile = res.locals.verifiedProfile;
  if (!profile) throw unauthorized();
  return profile;
}
