import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      name: string;
      email: string;
      image?: string | null;
      emailVerified?: boolean;
    };
    session?: {
      id: string;
      userId: string;
      expiresAt: Date;
    };
  }
}
