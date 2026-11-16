import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import type { AppDeps } from "./lib/deps";
import { AppError, toAppError } from "./lib/errors";
import { authenticate } from "./middlewares/authenticate";
import { academicRoutes } from "./modules/academics/routes";
import { attendanceRoutes } from "./modules/attendance/routes";
import { memberRoutes } from "./modules/members/routes";
import { joiningRoutes } from "./modules/members/joining-routes";
import { portalRoutes } from "./modules/portal/routes";
import { schoolRoutes } from "./modules/schools/routes";
import { studentRoutes } from "./modules/students/routes";
import resultsRouter from "./modules/results/router";
import resourcesRouter from "./modules/classroom/resources-router";
import assignmentsRouter from "./modules/assignments/router";
import timetableRouter from "./modules/classroom/timetable-router";

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function errorBody(req: Request, code: string, message: string) {
  return { error: { code, message, requestId: String(req.id ?? "") } };
}

export function createApp(deps: AppDeps): Express {
  const { config, database, logger } = deps;
  const app = express();

  app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());

  const healthz = (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  };
  app.get("/api/healthz", healthz);
  app.get("/api/v1/healthz", healthz);
  app.get("/api/v1/readyz", async (req, res) => {
    try {
      await database.ping();
      res.json({ status: "ready" });
    } catch (error) {
      req.log.error({ err: error }, "Readiness check failed");
      res.status(503).json(errorBody(req, "not_ready", "The database is not reachable."));
    }
  });

  if (config.corsAllowedOrigins.length > 0) {
    app.use(
      "/api",
      cors({
        origin: config.corsAllowedOrigins,
        credentials: true,
        methods: ["GET", "POST", "PATCH", "DELETE"],
        allowedHeaders: ["Authorization", "Content-Type", "X-School-Id", "X-Request-Id"],
        exposedHeaders: ["X-Request-Id"],
        maxAge: 600,
      }),
    );
  }

  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, "rate_limited", "Too many requests. Please slow down and try again.")),
    }),
  );

  app.use(express.json({ limit: "100kb" }));

  const v1 = express.Router();
  v1.use(authenticate(deps));
  v1.use(schoolRoutes(deps));
  v1.use(academicRoutes(deps));
  v1.use(studentRoutes(deps));
  v1.use(attendanceRoutes(deps));
  v1.use(memberRoutes(deps));
  v1.use(joiningRoutes(deps));
  v1.use(portalRoutes(deps));
  v1.use("/results", resultsRouter(deps));
  v1.use("/learning", resourcesRouter(deps));
  v1.use("/assignments", assignmentsRouter(deps));
  v1.use("/timetable", timetableRouter(deps));
  app.use("/api/v1", v1);

  app.use((req: Request, res: Response) => {
    res.status(404).json(errorBody(req, "not_found", "No such endpoint."));
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const parserType = (error as { type?: string } | null)?.type;
    if (parserType === "entity.parse.failed") {
      res.status(400).json(errorBody(req, "invalid_json", "The request body is not valid JSON."));
      return;
    }
    if (parserType === "entity.too.large") {
      res.status(413).json(errorBody(req, "payload_too_large", "The request body is too large."));
      return;
    }

    const appError = toAppError(error);
    if (appError) {
      if (appError.status >= 500) req.log.error({ err: error }, appError.message);
      else req.log.info({ code: appError.code, status: appError.status }, "Request rejected");
      res.status(appError.status).json(errorBody(req, appError.code, appError.message));
      return;
    }

    req.log.error({ err: error }, "Unhandled API error");
    res.status(500).json(errorBody(req, "internal_error", "Something went wrong. Please try again."));
  });

  return app;
}
