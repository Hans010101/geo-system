import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import type { User } from "../drizzle/schema";
import { parse as parseCookieHeader } from "cookie";

const scryptAsync = promisify(scrypt);

// ==================== Password Hashing ====================

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(plain, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(plain, salt, 64)) as Buffer;
  const keyBuffer = Buffer.from(key, "hex");
  if (derived.length !== keyBuffer.length) return false;
  return timingSafeEqual(derived, keyBuffer);
}

// ==================== JWT Session ====================

function getSessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createSessionToken(
  openId: string,
  name: string,
): Promise<string> {
  const secretKey = getSessionSecret();
  const expirationSeconds = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);

  return new SignJWT({ openId, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

export async function verifySession(
  cookieValue: string | undefined | null,
): Promise<{ openId: string; name: string } | null> {
  if (!cookieValue) return null;
  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, {
      algorithms: ["HS256"],
    });
    const { openId, name } = payload as Record<string, unknown>;
    if (typeof openId !== "string" || !openId) return null;
    return { openId, name: (name as string) || "" };
  } catch {
    return null;
  }
}

// ==================== Authenticate Request (used by tRPC context) ====================

export async function authenticateRequest(req: Request): Promise<User | null> {
  const cookies = req.headers.cookie ? parseCookieHeader(req.headers.cookie) : {};
  const sessionCookie = cookies[COOKIE_NAME];
  const session = await verifySession(sessionCookie);
  if (!session) return null;

  const user = await db.getUserByOpenId(session.openId);
  if (!user) return null;

  // Update lastSignedIn
  await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
  return user;
}

// ==================== Auth Routes (Express) ====================

export function registerAuthRoutes(app: Express) {
  // Register
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "username and password are required" });
        return;
      }
      if (typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "invalid input" });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "password must be at least 6 characters" });
        return;
      }

      // Check if username already exists (use username as openId)
      const existing = await db.getUserByOpenId(username);
      if (existing) {
        res.status(409).json({ error: "username already exists" });
        return;
      }

      const passwordHashValue = await hashPassword(password);

      // Check if this is the first user — auto-assign admin
      const database = await db.getDb();
      let isFirstUser = false;
      if (database) {
        const { count } = await import("drizzle-orm");
        const { users } = await import("../drizzle/schema");
        const result = await database.select({ count: count() }).from(users);
        isFirstUser = (result[0]?.count ?? 0) === 0;
      }

      await db.upsertUser({
        openId: username,
        name: username,
        passwordHash: passwordHashValue,
        loginMethod: "password",
        role: isFirstUser ? "admin" : "user",
        lastSignedIn: new Date(),
      });

      // Auto-login after registration
      const sessionToken = await createSessionToken(username, username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, role: isFirstUser ? "admin" : "user" });
    } catch (error: any) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "username and password are required" });
        return;
      }

      const user = await db.getUserByOpenId(username);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "invalid username or password" });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "invalid username or password" });
        return;
      }

      // Update lastSignedIn
      await db.upsertUser({ openId: username, lastSignedIn: new Date() });

      const sessionToken = await createSessionToken(user.openId, user.name || username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
