import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import {
  AcceptInvitationBody,
  AcceptInvitationResponse,
  CreateInvitationBody,
  CreateInvitationResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  RevokeInvitationParams,
  RevokeInvitationResponse,
  SetMemberCapabilitiesBody,
  SetMemberCapabilitiesParams,
  SetMemberCapabilitiesResponse,
  UpdateMemberBody,
  UpdateMemberParams,
  UpdateMemberResponse,
} from "@workspace/api-zod";
import { currentUserId, inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { AppError, forbidden, parseInput } from "../../lib/errors";
import { MANAGERS, STAFF } from "../../lib/roles";
import { currentProfile } from "../../middlewares/authenticate";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  listMembers,
  revokeInvitation,
  setMemberCapabilities,
  updateMember,
} from "./service";

export function memberRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database, config } = deps;

  // Tokens are 256-bit, so this is about abuse rather than guessing.
  const acceptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req, res) => res.locals.userId ?? ipKeyGenerator(req.ip ?? ""),
    handler: (_req, _res, next) =>
      next(new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.")),
  });

  router.get("/members", async (req, res) => {
    send(res, ListMembersResponse, await inSchool(
      database, req, res,
      { roles: STAFF, capability: ["people.manage", "academics.manage"] },
      listMembers,
    ));
  });

  router.patch("/members/:membershipId", async (req, res) => {
    const { membershipId } = parseInput(UpdateMemberParams, req.params);
    const input = parseInput(UpdateMemberBody, req.body);
    const member = await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "people.manage" },
      (tx, ctx) => updateMember(tx, ctx, membershipId, input),
    );
    send(res, UpdateMemberResponse, member);
  });

  router.patch("/members/:membershipId/capabilities", async (req, res) => {
    const { membershipId } = parseInput(SetMemberCapabilitiesParams, req.params);
    const input = parseInput(SetMemberCapabilitiesBody.strict(), req.body);
    const member = await inSchool(database, req, res, ["owner"], (tx, ctx) =>
      setMemberCapabilities(tx, ctx, membershipId, input.capabilities),
    );
    send(res, SetMemberCapabilitiesResponse, member);
  });

  router.get("/invitations", async (req, res) => {
    send(res, ListInvitationsResponse, await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "people.manage" },
      listInvitations,
    ));
  });

  router.post("/invitations", async (req, res) => {
    const input = parseInput(CreateInvitationBody, req.body);
    const created = await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "people.manage" },
      (tx, ctx) => createInvitation(tx, ctx, input, config.invitationTtlDays),
    );
    res.set("Cache-Control", "no-store");
    send(res, CreateInvitationResponse, created, 201);
  });

  router.post("/invitations/:invitationId/revoke", async (req, res) => {
    const { invitationId } = parseInput(RevokeInvitationParams, req.params);
    const invitation = await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "people.manage" },
      (tx, ctx) => revokeInvitation(tx, ctx, invitationId),
    );
    send(res, RevokeInvitationResponse, invitation);
  });

  router.post("/invitations/accept", acceptLimiter, async (req, res) => {
    const { token } = parseInput(AcceptInvitationBody, req.body);
    const userId = currentUserId(res);
    // Matched against the address verified in this request's ID token (synced by authenticate).
    const profile = currentProfile(res);
    if (!profile.email) throw forbidden("Verify your email address in your account settings first.");
    send(res, AcceptInvitationResponse, await acceptInvitation(database, userId, token));
  });

  return router;
}
