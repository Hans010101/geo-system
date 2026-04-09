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

// ==================== Helpers ====================

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function isFirstUser(): Promise<boolean> {
  const database = await db.getDb();
  if (!database) return false;
  const { count } = await import("drizzle-orm");
  const { users } = await import("../drizzle/schema");
  const result = await database.select({ count: count() }).from(users);
  return (result[0]?.count ?? 0) === 0;
}

// ==================== Auth Routes (Express) ====================

export function registerAuthRoutes(app: Express) {
  // Register
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "请输入用户名和密码" });
        return;
      }
      if (typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "输入格式无效" });
        return;
      }
      if (username.includes("@") && !isValidEmail(username)) {
        res.status(400).json({ error: "请输入有效的邮箱地址" });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "密码至少需要 6 个字符" });
        return;
      }

      // Check if username/email already exists
      const existing = await db.getUserByOpenId(username);
      if (existing) {
        if (username.includes("@")) {
          res.status(409).json({ error: "该邮箱已被注册" });
        } else {
          res.status(409).json({ error: "该用户名已被注册" });
        }
        return;
      }

      const passwordHashValue = await hashPassword(password);
      const firstUser = await isFirstUser();

      await db.upsertUser({
        openId: username,
        name: username,
        email: username.includes("@") ? username : null,
        passwordHash: passwordHashValue,
        loginMethod: "password",
        role: firstUser ? "admin" : "user",
        lastSignedIn: new Date(),
      });

      // Auto-login after registration
      const sessionToken = await createSessionToken(username, username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, role: firstUser ? "admin" : "user" });
    } catch (error: any) {
      console.error("[Auth] Register failed:", error);
      res.status(500).json({ error: "注册失败，请稍后再试" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "请输入用户名和密码" });
        return;
      }

      const user = await db.getUserByOpenId(username);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "用户名或密码错误" });
        return;
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "用户名或密码错误" });
        return;
      }

      await db.upsertUser({ openId: username, lastSignedIn: new Date() });

      const sessionToken = await createSessionToken(user.openId, user.name || username);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "登录失败，请稍后再试" });
    }
  });

  // ==================== Google OAuth ====================

  // GET /api/auth/google — redirect to Google consent screen
  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (!ENV.googleClientId) {
      res.status(500).json({ error: "Google OAuth is not configured" });
      return;
    }
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const redirectUri = `${proto}://${req.get("host")}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: ENV.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // GET /api/auth/google/callback — exchange code for token
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const code = req.query.code as string;
      if (!code) {
        res.status(400).send("Missing authorization code");
        return;
      }

      const proto = req.get("x-forwarded-proto") || req.protocol;
      const redirectUri = `${proto}://${req.get("host")}/api/auth/google/callback`;

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("[Google OAuth] Token exchange failed:", err);
        res.status(500).send("Google login failed");
        return;
      }

      const tokens = (await tokenRes.json()) as { access_token: string };

      // Get user info
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoRes.ok) {
        res.status(500).send("Failed to get user info from Google");
        return;
      }

      const googleUser = (await userInfoRes.json()) as {
        id: string;
        email: string;
        name: string;
        picture?: string;
      };

      // Use email as openId for Google users
      const openId = `google:${googleUser.email}`;
      let user = await db.getUserByOpenId(openId);

      if (!user) {
        // Auto-create user; first user is admin
        const firstUser = await isFirstUser();
        await db.upsertUser({
          openId,
          name: googleUser.name || googleUser.email,
          email: googleUser.email,
          loginMethod: "google",
          role: firstUser ? "admin" : "user",
          lastSignedIn: new Date(),
        });
        user = await db.getUserByOpenId(openId);
      } else {
        await db.upsertUser({ openId, lastSignedIn: new Date() });
      }

      if (!user) {
        res.status(500).send("Failed to create user");
        return;
      }

      const sessionToken = await createSessionToken(user.openId, user.name || googleUser.email);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect("/");
    } catch (error: any) {
      console.error("[Google OAuth] Callback failed:", error);
      res.status(500).send("Google login failed");
    }
  });

  // GET /api/auth/google/enabled — check if Google OAuth is configured
  app.get("/api/auth/google/enabled", (_req: Request, res: Response) => {
    res.json({ enabled: Boolean(ENV.googleClientId && ENV.googleClientSecret) });
  });
}
