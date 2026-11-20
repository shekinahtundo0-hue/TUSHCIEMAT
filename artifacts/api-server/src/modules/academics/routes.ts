import { Router } from "express";
import {
  AssignTeacherBody,
  AssignTeacherParams,
  AssignTeacherResponse,
  CreateAcademicYearBody,
  CreateAcademicYearResponse,
  CreateClassBody,
  CreateClassResponse,
  CreateTermBody,
  CreateTermParams,
  CreateTermResponse,
  ListAcademicYearsResponse,
  ListClassesResponse,
  RemoveTeacherAssignmentParams,
  SetCurrentAcademicYearParams,
  SetCurrentAcademicYearResponse,
  SetCurrentTermParams,
  SetCurrentTermResponse,
} from "@workspace/api-zod";
import { inSchool, send, sendNoContent } from "../../lib/context";
import type { AppDeps } from "../../lib/deps";
import { parseInput } from "../../lib/errors";
import { ANY_MEMBER, STAFF, STUDENT_VIEWERS } from "../../lib/roles";
import {
  assignTeacher,
  createAcademicYear,
  createClass,
  createTerm,
  listAcademicYears,
  listClasses,
  removeTeacherAssignment,
  setCurrentAcademicYear,
  setCurrentTerm,
} from "./service";

export function academicRoutes(deps: AppDeps): Router {
  const router = Router();
  const { database } = deps;

  router.get("/academic-years", async (req, res) => {
    send(res, ListAcademicYearsResponse, await inSchool(database, req, res, ANY_MEMBER, listAcademicYears));
  });

  router.post("/academic-years", async (req, res) => {
    const input = parseInput(CreateAcademicYearBody, req.body);
    const year = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => createAcademicYear(tx, ctx, input));
    send(res, CreateAcademicYearResponse, year, 201);
  });

  router.post("/academic-years/:academicYearId/current", async (req, res) => {
    const { academicYearId } = parseInput(SetCurrentAcademicYearParams, req.params);
    const year = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => setCurrentAcademicYear(tx, ctx, academicYearId));
    send(res, SetCurrentAcademicYearResponse, year);
  });

  router.post("/academic-years/:academicYearId/terms", async (req, res) => {
    const { academicYearId } = parseInput(CreateTermParams, req.params);
    const input = parseInput(CreateTermBody, req.body);
    const term = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => createTerm(tx, ctx, academicYearId, input));
    send(res, CreateTermResponse, term, 201);
  });

  router.post("/terms/:termId/current", async (req, res) => {
    const { termId } = parseInput(SetCurrentTermParams, req.params);
    const term = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => setCurrentTerm(tx, ctx, termId));
    send(res, SetCurrentTermResponse, term);
  });

  router.get("/classes", async (req, res) => {
    send(res, ListClassesResponse, await inSchool(database, req, res, STUDENT_VIEWERS, listClasses));
  });

  router.post("/classes", async (req, res) => {
    const input = parseInput(CreateClassBody, req.body);
    const created = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => createClass(tx, ctx, input));
    send(res, CreateClassResponse, created, 201);
  });

  router.post("/classes/:classId/teachers", async (req, res) => {
    const { classId } = parseInput(AssignTeacherParams, req.params);
    const input = parseInput(AssignTeacherBody, req.body);
    const assignment = await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => assignTeacher(tx, ctx, classId, input));
    send(res, AssignTeacherResponse, assignment, 201);
  });

  router.delete("/classes/:classId/teachers/:assignmentId", async (req, res) => {
    const { classId, assignmentId } = parseInput(RemoveTeacherAssignmentParams, req.params);
    await inSchool(database, req, res, { roles: STAFF, capability: "academics.manage" }, (tx, ctx) => removeTeacherAssignment(tx, ctx, classId, assignmentId));
    sendNoContent(res);
  });

  return router;
}
