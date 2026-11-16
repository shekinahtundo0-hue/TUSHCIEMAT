import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  GetDiscoverableSchoolParams, GetDiscoverableSchoolResponse,
  JoinWithInvitationBody, JoinWithInvitationParams, JoinWithInvitationResponse,
  ListAnnouncementsResponse, ListDiscoverableSchoolsQueryParams, ListDiscoverableSchoolsResponse,
  ListJoinRequestsResponse, ListMyJoinRequestsResponse, ListNotificationsResponse,
  MarkNotificationReadParams, MarkNotificationReadResponse,
  PublishAnnouncementBody, PublishAnnouncementResponse,
  ReviewJoinRequestBody, ReviewJoinRequestParams, ReviewJoinRequestResponse,
  SubmitJoinRequestBody, SubmitJoinRequestParams, SubmitJoinRequestResponse,
} from "@workspace/api-zod";
import { currentUserId, inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { AppError, forbidden, parseInput } from "../../lib/errors";
import { ANY_MEMBER, MANAGERS } from "../../lib/roles";
import { currentProfile } from "../../middlewares/authenticate";
import {
  discoverSchools, getDiscoverableSchool, joinWithInvitation, listAnnouncements, listJoinRequests,
  listMyJoinRequests, listNotifications, markNotificationRead, publishAnnouncement, reviewJoinRequest, submitJoinRequest,
} from "./joining";

export function joiningRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (_req, res) => currentUserId(res),
    handler: (_req, _res, next) => next(new AppError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.")),
  });
  const invitationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (_req, res) => currentUserId(res),
    handler: (_req, _res, next) => next(new AppError(429, "rate_limited", "Too many invitation attempts. Please wait a few minutes and try again.")),
  });

  router.get("/schools/discover", async (req, res) => {
    const { search, page } = parseInput(ListDiscoverableSchoolsQueryParams, req.query);
    const data = await database.asUser(currentUserId(res), (tx) => discoverSchools(tx, search ?? "", page ?? 1));
    send(res, ListDiscoverableSchoolsResponse, data);
  });
  router.get("/schools/discover/:schoolId", async (req, res) => {
    const { schoolId } = parseInput(GetDiscoverableSchoolParams, req.params);
    send(res, GetDiscoverableSchoolResponse, await database.asUser(currentUserId(res), (tx) => getDiscoverableSchool(tx, schoolId)));
  });
  router.post("/schools/:schoolId/join-requests", writeLimiter, async (req, res) => {
    const { schoolId } = parseInput(SubmitJoinRequestParams, req.params);
    const input = parseInput(SubmitJoinRequestBody.strict(), req.body);
    if (!currentProfile(res).email) throw forbidden("Verify your email before requesting school membership.");
    send(res, SubmitJoinRequestResponse, await database.asUser(currentUserId(res), (tx) => submitJoinRequest(tx, schoolId, input)), 201);
  });
  router.post("/schools/:schoolId/join-with-invitation", invitationLimiter, async (req, res) => {
    const { schoolId } = parseInput(JoinWithInvitationParams, req.params);
    const { token, role } = parseInput(JoinWithInvitationBody, req.body);
    if (!currentProfile(res).email) throw forbidden("Verify your email before accepting a school invitation.");
    res.set("Cache-Control", "no-store");
    send(res, JoinWithInvitationResponse, await database.asUser(currentUserId(res), (tx) => joinWithInvitation(tx, schoolId, token, role)));
  });
  router.get("/join-requests/mine", async (_req, res) => {
    const userId = currentUserId(res);
    send(res, ListMyJoinRequestsResponse, await database.asUser(userId, (tx) => listMyJoinRequests(tx, userId)));
  });
  router.get("/join-requests", async (req, res) => {
    send(res, ListJoinRequestsResponse, await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "requests.review" },
      listJoinRequests,
    ));
  });
  router.post("/join-requests/:requestId/review", async (req, res) => {
    const { requestId } = parseInput(ReviewJoinRequestParams, req.params);
    const input = parseInput(ReviewJoinRequestBody.strict(), req.body);
    send(res, ReviewJoinRequestResponse, await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "requests.review" },
      (tx, ctx) => reviewJoinRequest(tx, ctx, requestId, input),
    ));
  });
  router.get("/notifications", async (_req, res) => {
    const userId = currentUserId(res);
    send(res, ListNotificationsResponse, await database.asUser(userId, (tx) => listNotifications(tx, userId)));
  });
  router.post("/notifications/:notificationId/read", async (req, res) => {
    const { notificationId } = parseInput(MarkNotificationReadParams, req.params);
    const userId = currentUserId(res);
    send(res, MarkNotificationReadResponse, await database.asUser(userId, (tx) => markNotificationRead(tx, userId, notificationId)));
  });
  router.get("/announcements", async (req, res) => {
    send(res, ListAnnouncementsResponse, await inSchool(database, req, res, ANY_MEMBER, listAnnouncements));
  });
  router.post("/announcements", async (req, res) => {
    const { title, body } = parseInput(PublishAnnouncementBody.strict(), req.body);
    send(res, PublishAnnouncementResponse, await inSchool(
      database, req, res,
      { roles: MANAGERS, capability: "announcements.manage" },
      (tx, ctx) => publishAnnouncement(tx, ctx, title, body),
    ), 201);
  });
  return router;
}
