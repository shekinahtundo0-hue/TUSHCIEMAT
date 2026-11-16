import { Router } from "express";
import {
  AddGuardianBody,
  AddGuardianParams,
  AddGuardianResponse,
  CreateStudentBody,
  CreateStudentResponse,
  GetStudentParams,
  GetStudentResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  RemoveGuardianParams,
  UpdateStudentBody,
  UpdateStudentParams,
  UpdateStudentResponse,
} from "@workspace/api-zod";
import { inSchool, send } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput } from "../../lib/errors";
import { STAFF, STUDENT_VIEWERS } from "../../lib/roles";
import {
  addGuardian,
  createStudent,
  getStudent,
  listStudents,
  removeGuardian,
  updateStudent,
} from "./service";

export function studentRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  router.get("/students", async (req, res) => {
    const query = parseInput(ListStudentsQueryParams, req.query);
    const page = await inSchool(database, req, res, STUDENT_VIEWERS, (tx, ctx) => listStudents(tx, ctx, query));
    send(res, ListStudentsResponse, page);
  });

  router.post("/students", async (req, res) => {
    const input = parseInput(CreateStudentBody, req.body);
    const student = await inSchool(database, req, res, { roles: STAFF, capability: "students.manage" }, (tx, ctx) => createStudent(tx, ctx, input));
    send(res, CreateStudentResponse, student, 201);
  });

  router.get("/students/:studentId", async (req, res) => {
    const { studentId } = parseInput(GetStudentParams, req.params);
    const student = await inSchool(database, req, res, STUDENT_VIEWERS, (tx, ctx) => getStudent(tx, ctx, studentId));
    send(res, GetStudentResponse, student);
  });

  router.patch("/students/:studentId", async (req, res) => {
    const { studentId } = parseInput(UpdateStudentParams, req.params);
    const input = parseInput(UpdateStudentBody, req.body);
    const student = await inSchool(database, req, res, { roles: STAFF, capability: "students.manage" }, (tx, ctx) => updateStudent(tx, ctx, studentId, input));
    send(res, UpdateStudentResponse, student);
  });

  router.post("/students/:studentId/guardians", async (req, res) => {
    const { studentId } = parseInput(AddGuardianParams, req.params);
    const input = parseInput(AddGuardianBody, req.body);
    const link = await inSchool(database, req, res, { roles: STAFF, capability: "students.manage" }, (tx, ctx) => addGuardian(tx, ctx, studentId, input));
    send(res, AddGuardianResponse, link, 201);
  });

  router.delete("/students/:studentId/guardians/:guardianId", async (req, res) => {
    const { studentId, guardianId } = parseInput(RemoveGuardianParams, req.params);
    await inSchool(database, req, res, { roles: STAFF, capability: "students.manage" }, (tx, ctx) => removeGuardian(tx, ctx, studentId, guardianId));
    res.status(204).end();
  });

  return router;
}
