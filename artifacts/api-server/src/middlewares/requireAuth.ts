import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Locals {
      userId?: string;
    }
  }
}

const requireAuth: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in is required." });
    return;
  }

  res.locals.userId = userId;
  next();
};

export default requireAuth;
