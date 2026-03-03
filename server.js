import "dotenv/config";
import express from "express";
import session from "express-session";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LinkedInStrategy } from "passport-linkedin-oauth2";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret";
const COOKIE_SECURE = envBool(process.env.COOKIE_SECURE, IS_PROD);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const dbPath = path.join(dataDir, "app.db");
const documentPath = path.join(dataDir, "document.pdf");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    email TEXT,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id)
  );

  CREATE TABLE IF NOT EXISTS email_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    organization TEXT NOT NULL,
    stance TEXT NOT NULL CHECK (stance IN ('support', 'oppose')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

const findUserById = db.prepare("SELECT * FROM users WHERE id = ?");
const findUserByProvider = db.prepare(
  "SELECT * FROM users WHERE provider = ? AND provider_user_id = ?"
);
const createUser = db.prepare(
  "INSERT INTO users (provider, provider_user_id, email, name) VALUES (?, ?, ?, ?)"
);
const updateUserProfile = db.prepare("UPDATE users SET email = ?, name = ? WHERE id = ?");
const insertEmailCode = db.prepare(
  "INSERT INTO email_codes (email, code, expires_at) VALUES (?, ?, ?)"
);
const findValidEmailCode = db.prepare(
  `SELECT * FROM email_codes
   WHERE email = ? AND code = ? AND used_at IS NULL AND expires_at > datetime('now')
   ORDER BY id DESC LIMIT 1`
);
const markEmailCodeUsed = db.prepare("UPDATE email_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?");
const findSignatureByUser = db.prepare(
  "SELECT s.*, u.email, u.name FROM signatures s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?"
);
const insertSignature = db.prepare(
  "INSERT INTO signatures (user_id, organization, stance) VALUES (?, ?, ?)"
);
const listSignatures = db.prepare(
  `SELECT s.id, s.organization, s.stance, s.created_at, u.email, u.name
   FROM signatures s
   JOIN users u ON u.id = s.user_id
   ORDER BY s.created_at DESC`
);
const deleteSignature = db.prepare("DELETE FROM signatures WHERE id = ?");

function upsertUser({ provider, providerUserId, email, name }) {
  const existing = findUserByProvider.get(provider, providerUserId);
  if (existing) {
    if (existing.email !== email || existing.name !== name) {
      updateUserProfile.run(email || null, name || null, existing.id);
    }
    return findUserById.get(existing.id);
  }

  const result = createUser.run(provider, providerUserId, email || null, name || null);
  return findUserById.get(result.lastInsertRowid);
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = findUserById.get(id);
  done(null, user || false);
});

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: `${APP_BASE_URL}/auth/google/callback`
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value || null;
        const user = upsertUser({
          provider: "google",
          providerUserId: profile.id,
          email,
          name: profile.displayName || null
        });
        done(null, user);
      }
    )
  );
}

const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
const linkedinClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
if (linkedinClientId && linkedinClientSecret) {
  passport.use(
    new LinkedInStrategy(
      {
        clientID: linkedinClientId,
        clientSecret: linkedinClientSecret,
        callbackURL: `${APP_BASE_URL}/auth/linkedin/callback`,
        scope: ["openid", "profile", "email"],
        state: true
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value || null;
        const user = upsertUser({
          provider: "linkedin",
          providerUserId: profile.id,
          email,
          name: profile.displayName || null
        });
        done(null, user);
      }
    )
  );
}

const app = express();
if (IS_PROD) app.set("trust proxy", 1);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dataDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, ext === ".pdf" ? "document.pdf" : "document.pdf");
    }
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      path.extname(file.originalname || "").toLowerCase() === ".pdf";
    cb(isPdf ? null : new Error("Only PDF is allowed"), isPdf);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: "lax",
      httpOnly: true,
      secure: COOKIE_SECURE
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use((req, _res, next) => {
  req.isAdmin = Boolean(req.user?.email && ADMIN_EMAILS.has(req.user.email.toLowerCase()));
  next();
});

const sseClients = new Set();

function getSignatureSnapshot() {
  const signatures = listSignatures.all().map((item) => ({
    id: item.id,
    organization: item.organization,
    stance: item.stance,
    createdAt: item.created_at
  }));

  const summary = signatures.reduce(
    (acc, cur) => {
      if (cur.stance === "support") acc.support += 1;
      else acc.oppose += 1;
      return acc;
    },
    { support: 0, oppose: 0 }
  );

  return { signatures, summary };
}

function pushSignaturesUpdate() {
  const payload = JSON.stringify({ type: "signatures:update", ...getSignatureSnapshot() });
  for (const res of sseClients) {
    res.write(`event: signatures\n`);
    res.write(`data: ${payload}\n\n`);
  }
}

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "AUTH_REQUIRED" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!req.isAdmin) return res.status(403).json({ error: "ADMIN_ONLY" });
  next();
}

app.get("/auth/google", (req, res, next) => {
  if (!googleClientId || !googleClientSecret) {
    return res.status(503).send("Google OAuth не налаштований");
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/?login=error"
  }),
  (_req, res) => {
    res.redirect("/");
  }
);

app.get("/auth/linkedin", (req, res, next) => {
  if (!linkedinClientId || !linkedinClientSecret) {
    return res.status(503).send("LinkedIn OAuth не налаштований");
  }
  passport.authenticate("linkedin")(req, res, next);
});

app.get(
  "/auth/linkedin/callback",
  passport.authenticate("linkedin", {
    failureRedirect: "/?login=error"
  }),
  (_req, res) => {
    res.redirect("/");
  }
);

app.post("/api/auth/email/start", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "INVALID_EMAIL" });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  insertEmailCode.run(email, code, expiresAt);

  // Demo-режим: код повертається у відповідь. Для production замінити на email-відправку.
  res.json({ ok: true, code, expiresAt });
});

app.post("/api/auth/email/verify", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const record = findValidEmailCode.get(email, code);
  if (!record) {
    return res.status(400).json({ error: "INVALID_OR_EXPIRED_CODE" });
  }

  markEmailCodeUsed.run(record.id);
  const user = upsertUser({ provider: "email", providerUserId: email, email, name: email });
  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: "LOGIN_FAILED" });
    return res.json({ ok: true });
  });
});

app.get("/api/session", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({ authenticated: false });
  }

  const signature = findSignatureByUser.get(req.user.id);
  return res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      isAdmin: req.isAdmin
    },
    hasSigned: Boolean(signature),
    signature: signature
      ? {
          id: signature.id,
          organization: signature.organization,
          stance: signature.stance,
          createdAt: signature.created_at
        }
      : null
  });
});

app.post("/api/signature", requireAuth, (req, res) => {
  const existing = findSignatureByUser.get(req.user.id);
  if (existing) {
    return res.status(409).json({ error: "ALREADY_SIGNED" });
  }

  const organization = String(req.body.organization || "").trim();
  const stance = req.body.stance === "oppose" ? "oppose" : "support";

  if (organization.length < 2 || organization.length > 160) {
    return res.status(400).json({ error: "INVALID_ORGANIZATION" });
  }

  insertSignature.run(req.user.id, organization, stance);
  pushSignaturesUpdate();
  return res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "LOGOUT_FAILED" });
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get("/api/signatures", (_req, res) => {
  res.json(getSignatureSnapshot());
});

app.get("/api/signatures/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  const payload = JSON.stringify({ type: "signatures:init", ...getSignatureSnapshot() });
  res.write(`event: signatures\n`);
  res.write(`data: ${payload}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.delete("/api/admin/signatures/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "INVALID_ID" });
  }
  deleteSignature.run(id);
  pushSignaturesUpdate();
  return res.json({ ok: true });
});

app.post("/api/admin/document", requireAdmin, upload.single("document"), (_req, res) => {
  res.json({ ok: true });
});

app.get("/document.pdf", (_req, res) => {
  if (!fs.existsSync(documentPath)) {
    return res.status(404).send("Документ поки не завантажено");
  }
  res.sendFile(documentPath);
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Server running at ${APP_BASE_URL} (${NODE_ENV})`);
  console.log(`Data dir: ${dataDir}`);
});
