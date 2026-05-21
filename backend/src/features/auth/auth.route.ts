import { toNodeHandler } from "better-auth/node";
import { Router } from "express";
import { auth } from "./auth.js";

const authRouter = Router();

authRouter.all("/*splat", toNodeHandler(auth));

export { authRouter };
