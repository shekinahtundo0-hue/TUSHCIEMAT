import { Router } from "express";
import {
  GetAttendanceRegisterQueryParams,
  GetAttendanceRegisterResponse,
  SaveAttendanceBody,
  SaveAttendanceResponse,
} from "@workspace/api-zod";
import { inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput } from "../../lib/errors";
import { ATTENDANCE_TAKERS } from "../../lib/roles";
import { getRegister, saveAttendance } from "./service";

export function attendanceRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database, config } = deps;

  router.get("/attendance", async (req, res) => {
    const { classId, date } = parseInput(GetAttendanceRegisterQueryParams, req.query);
    const register = await inSchool(database, req, res, { roles: ATTENDANCE_TAKERS, capability: "attendance.manage", scopedRoles: ["teacher"] }, (tx, ctx) =>
      getRegister(tx, ctx, classId, date),
    );
    send(res, GetAttendanceRegisterResponse, register);
  });

  router.post("/attendance", async (req, res) => {
    const input = parseInput(SaveAttendanceBody, req.body);
    const register = await inSchool(database, req, res, { roles: ATTENDANCE_TAKERS, capability: "attendance.manage", scopedRoles: ["teacher"] }, (tx, ctx) =>
      saveAttendance(tx, ctx, input, config.timezone),
    );
    send(res, SaveAttendanceResponse, register);
  });

  return router;
}
