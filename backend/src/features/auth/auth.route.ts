import { toNodeHandler } from "better-auth/node";
import { Router } from "express";
import { auth } from "./auth.js";
import { claimSessionHandoff, startSessionHandoff } from "./session-handoff.js";

const authRouter = Router();

authRouter.get("/session-handoff/start", startSessionHandoff);
authRouter.get("/session-handoff/claim", claimSessionHandoff);
authRouter.all("/*splat", toNodeHandler(auth));

export { authRouter };
