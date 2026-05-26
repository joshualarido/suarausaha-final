import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { authRouter } from "./features/auth/auth.route.js";
import { businessRouter } from "./features/business/business.route.js";
import { chatRouter } from "./features/chat/chat.route.js";
import { confirmationRouter } from "./features/confirmations/confirmation.route.js";
import { healthRouter } from "./features/health/health.route.js";
import { menuItemRouter } from "./features/menu-items/menu-item.route.js";
import { openingBalanceRouter } from "./features/opening-balance/opening-balance.route.js";
import { overviewRouter } from "./features/overview/overview.route.js";
import { paymentAccountRouter } from "./features/payment-accounts/payment-account.route.js";
import { transactionRouter } from "./features/transactions/transaction.route.js";
import { userRouter } from "./features/users/user.route.js";

export const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/v1/health", healthRouter);
app.use("/api/v1", userRouter);
app.use("/api/v1", businessRouter);
app.use("/api/v1", menuItemRouter);
app.use("/api/v1", openingBalanceRouter);
app.use("/api/v1", overviewRouter);
app.use("/api/v1", paymentAccountRouter);
app.use("/api/v1", chatRouter);
app.use("/api/v1", confirmationRouter);
app.use("/api/v1", transactionRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (env.NODE_ENV !== "test") {
    // Keep logs concise and avoid leaking sensitive request context.
    console.error(err);
  }
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
    },
  });
});
