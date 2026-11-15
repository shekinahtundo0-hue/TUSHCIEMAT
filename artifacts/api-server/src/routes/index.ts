import { Router, type IRouter } from "express";
import healthRouter from "./health";
import requireAuth from "../middlewares/requireAuth";
import schoolsRouter from "./schools";
import studentsRouter from "./students";
import classesRouter from "./classes";
import attendanceRouter from "./attendance";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(schoolsRouter);
router.use(studentsRouter);
router.use(classesRouter);
router.use(attendanceRouter);

export default router;
