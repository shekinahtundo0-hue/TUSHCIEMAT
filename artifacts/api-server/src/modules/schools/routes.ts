import { Router } from "express";
import {
  CreateSchoolBody,
  CreateSchoolResponse,
  GetDashboardResponse,
  GetMeResponse,
  GetSchoolSettingsResponse,
  UpdateSchoolSettingsBody,
  UpdateSchoolSettingsResponse,
  ListPlatformSchoolsResponse,
} from "@workspace/api-zod";
import { currentUserId, inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { forbidden, parseInput } from "../../lib/errors";
import { MANAGERS, STAFF } from "../../lib/roles";
import { currentProfile } from "../../middlewares/authenticate";
import { getMe } from "../account/service";
import { platformSchools } from "../platform/service";
import { createSchool, getDashboard, getSchoolSettings, updateSchoolSettings } from "./service";

export function schoolRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database, config } = deps;

  router.get("/me", async (_req, res) => {
    send(res, GetMeResponse, await getMe(database, currentProfile(res)));
  });

  router.post("/schools", async (req, res) => {
    const input = parseInput(CreateSchoolBody.strict(), req.body);
    send(res, CreateSchoolResponse, await createSchool(database, currentUserId(res), input), 201);
  });

  router.get("/dashboard", async (req, res) => {
    const data = await inSchool(database, req, res, STAFF, (tx, ctx) => getDashboard(tx, ctx, config.timezone));
    send(res, GetDashboardResponse, data);
  });

  router.get("/school-settings", async (req, res) => {
    send(res, GetSchoolSettingsResponse, await inSchool(database, req, res, MANAGERS, getSchoolSettings));
  });

  router.patch("/school-settings", async (req, res) => {
    const input = parseInput(UpdateSchoolSettingsBody.strict(), req.body);
    send(res, UpdateSchoolSettingsResponse, await inSchool(
      database, req, res,
      { roles: STAFF, capability: "settings.manage" },
      (tx, ctx) => updateSchoolSettings(tx, ctx, input),
    ));
  });

  router.get("/platform/schools", async (_req, res) => {
    const profile = currentProfile(res);
    if (!profile.platformRole) throw forbidden("Platform access is required.");
    send(res, ListPlatformSchoolsResponse, await database.asUser(profile.authUserId, platformSchools));
  });

  return router;
}
