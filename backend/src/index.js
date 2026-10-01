import http from 'http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import prisma from './prismaClient.js';
import analyticsRouter from './routes/analytics.js';
import dispatchFactory from './routes/dispatch.js';
import sessionsFactory from './routes/sessions.js';
import walletRouter from './routes/wallet.js';
import {
  authMiddleware,
  createSessionForUser,
  requireAdmin,
  requireRole,
  resolveUserFromToken,
  revokeSession,
  revokeAllSessionsForUser,
  signSessionToken,
} from './middleware/auth.js';
import { setSessionCookie, clearSessionCookieHeader } from './services/sessionCookie.js';
import { listIdentitiesForUser, unlinkIdentity } from './services/accountLinking.js';
import {
  ROLE_ADMIN,
  ROLE_SUPER_ADMIN,
  defaultRole,
  isSuperAdminRole,
  normalizeEmailAddress,
  normalizeRole,
  serializeUser,
  validateEmail,
  validatePassword,
  validateUsername,
} from './utils/security.js';
import oauthRouter from './routes/oauth.js';
import { assertOAuthConfiguration } from './services/oauthService.js';
import rateLimit, {
  loginLimiter,
  registerLimiter,
  verifyLimiter,
  taskCreateLimiter,
  payoutLimiter,
  factoryLimiter,
  dispatchLimiter,
} from './middleware/rateLimit.js';
import securityHeaders from './middleware/securityHeaders.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';
import { executeAgentTask } from './services/agentService.js';
import { fallbackProvider, getProviderSpec, primaryProvider, providerFallbackOrder, providerIsConfigured, providerModel } from './services/llmProvider.js';
import { computeUserEarnings, earningRateEth } from './services/earningsService.js';
import { economicCapabilityReport } from './services/moneySemantics.js';
import { ensureRewardPool } from './services/rewardService.js';
import { ensureComputeServiceCatalog } from './services/compute/catalogService.js';
import {
  getEmailProviderStatus,
  issueEmailVerificationToken,
  sendVerificationEmail,
  verifyEmailByToken,
} from './services/emailService.js';
import {
  DEFAULT_TASK_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
} from './agents/agentRunner.js';
import { classifyAgent } from './agents/taskClassifier.js';
import { getAgentRuntimeStatus, getProviderRuntimeStatus } from './agents/agentRegistry.js';
import {
  approvePayout,
  listPayouts,
  listPayoutsForAdmin,
  getPayoutForApproval,
  payoutRuntimeSnapshot,
  preparePayoutPlan,
  refreshPayoutStatus,
  rejectPayout,
  summariseTaskResult,
  normalizeNetwork,
  isValidAddressForNetwork,
} from './services/payoutService.js';
import './workers/agentWorker.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET env var is not set.');
  process.exit(1);
}

// OAuth startup validation: if a provider is enabled but its redirect URI is
// unresolvable OR does not point at this backend, fail clearly instead of
// shipping a broken callback. In production this blocks boot; in development it
// logs a clear warning.
//
// Production previously ran with the FRONTEND origin configured as the OAuth
// redirect URI. Google authenticated the user, then delivered the authorization
// code to a frontend page that ignored it, so no session was ever created and
// the user was bounced straight back to /login. validateRedirectUriForBackend()
// now rejects that configuration outright so it cannot ship again.
const oauthValid = assertOAuthConfiguration();
if (!oauthValid && process.env.NODE_ENV === 'production') {
  logger.error('FATAL: OAuth configuration is invalid. Fix the redirect URI configuration and redeploy.');
  process.exit(1);
}

const prismaSchemaPath = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const prismaBinPath = fileURLToPath(new URL('../node_modules/.bin/prisma', import.meta.url));

function syncDatabaseSchema() {
  logger.info('Applying database migrations (prisma migrate deploy)...');
  try {
    execSync(`"${prismaBinPath}" migrate deploy --schema="${prismaSchemaPath}"`, {
      stdio: 'inherit',
    });
  } catch (error) {
    logger.error('prisma migrate deploy failed', error);
    process.exit(1);
  }
}

// Ensure migrations are applied before serving traffic. Uses the non-destructive
// `prisma migrate deploy`: it applies only pending migration files and never
// runs sequence-requiring / data-loss commands like `db push --accept-data-loss`.
syncDatabaseSchema();

const app = express();
app.disable('x-powered-by');
// Render terminates TLS in front of the app; trusting the first proxy hop keeps
// req.ip correct for IP-keyed rate limiters.
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });

const isProduction = process.env.NODE_ENV === 'production';

const configuredOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URLS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// CORS: the production frontend is always allowed. Localhost origins are only
// enabled outside production — stale local/Railway origins must never be
// trusted against the live API.
const ALLOWED_ORIGINS = isProduction
  ? ['https://agentfinance.onrender.com', ...configuredOrigins]
  : ['https://agentfinance.onrender.com', 'http://localhost:3000', 'http://localhost:4000', ...configuredOrigins];

app.use(cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, healthchecks, servers) send no Origin header.
    if (!origin) return callback(null, true);
    return callback(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true,
}));
app.use(rateLimit);
app.use(securityHeaders);
app.use(express.json({ limit: '256kb' }));

const REDIS_URL = process.env.REDIS_URL;
const redis = REDIS_URL && !REDIS_URL.includes('{{')
  ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
  : null;
const taskQueue = redis ? new Queue('agent-tasks', { connection: redis }) : null;

if (!redis) {
  logger.warn('No REDIS_URL configured. BullMQ queue disabled; tasks will run inline.');
}

// Session signing lives in middleware/auth.js so the HTTP cookie path, the
// OAuth callback and the WebSocket handshake all mint tokens identically.
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function bootstrapAdmins() {
  const names = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (names.length === 0) return;

  const result = await prisma.user.updateMany({
    where: { username: { in: names } },
    data: { role: 'ADMIN' },
  });

  if (result.count > 0) {
    logger.info(`Bootstrapped ${result.count} account(s) to ADMIN role from ADMIN_USERNAMES.`);
  }
}

// Enforce a single SUPER_ADMIN. The owner is set via SUPER_ADMIN_USERNAME
// (defaults to the okwedavid owner account). Extra SUPER_ADMIN accounts are
// demoted to ADMIN. Account creation itself is never automated.
async function ensureSuperAdmin() {
  try {
    const ownerUsername = process.env.SUPER_ADMIN_USERNAME || 'okwedavid';
    const owner = await prisma.user.findUnique({ where: { username: ownerUsername } });
    if (owner && owner.role !== ROLE_SUPER_ADMIN) {
      await prisma.user.update({
        where: { id: owner.id },
        data: { role: ROLE_SUPER_ADMIN },
      });
      logger.info(`Promoted ${ownerUsername} to SUPER_ADMIN.`);
    }

    const superAdmins = await prisma.user.findMany({ where: { role: ROLE_SUPER_ADMIN } });
    for (const admin of superAdmins) {
      if (admin.username !== ownerUsername) {
        await prisma.user.update({
          where: { id: admin.id },
          data: { role: ROLE_ADMIN },
        });
        logger.info(`Demoted ${admin.username} to ADMIN (only ${ownerUsername} may be super admin).`);
      }
    }
  } catch (error) {
    logger.warn('ensureSuperAdmin skipped', error.message);
  }
}

async function bootstrapRun() {
  try {
    await bootstrapAdmins();
    await ensureSuperAdmin();
  } catch (error) {
    logger.warn('role bootstrap skipped', error.message);
  }
}

function parseTaskResult(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function publish(channel, payload) {
  if (!redis) return;
  await redis.publish(channel, JSON.stringify(payload));
}

function sanitizeTask(task) {
  const parsedResult = parseTaskResult(task.result);
  const summary = summariseTaskResult(parsedResult);
  return {
    ...task,
    result: parsedResult,
    summary,
  };
}

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredAgentIds() {
  return (process.env.AGENTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// Abuse protection for expensive AI jobs: bounded action size, an allowlisted
// agent target (never an arbitrary client-supplied name) and per-user active /
// concurrent task caps so a caller cannot flood unlimited work into the queue.
const MAX_TASK_ACTION_LENGTH = envInt('MAX_TASK_ACTION_LENGTH', 2000);
const MAX_ACTIVE_TASKS = envInt('MAX_ACTIVE_TASKS', 25);
const MAX_CONCURRENT_TASKS = envInt('MAX_CONCURRENT_TASKS', 3);
const MAX_TASK_RETRIES = envInt('MAX_TASK_RETRIES', 3);

function taskCapacityError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function assertTaskCapacity(userId, { checkConcurrent = true } = {}) {
  const ACTIVE = ['pending', 'queued', 'running', 'retrying'];
  const rows = await prisma.task.findMany({
    where: { userId, archived: false, status: { in: ACTIVE } },
    select: { status: true },
  });
  if (rows.length >= MAX_ACTIVE_TASKS) {
    throw taskCapacityError(429, 'Too many active tasks. Archive or cancel a task before creating more.');
  }
  if (checkConcurrent) {
    const busy = rows.filter((row) => row.status !== 'pending' && row.status !== 'retrying').length;
    if (busy >= MAX_CONCURRENT_TASKS) {
      throw taskCapacityError(429, 'Too many tasks are running concurrently. Wait for one to finish.');
    }
  }
}

function normalizeAgentTarget(agentId) {
  if (typeof agentId !== 'string') return null;
  const value = agentId.trim();
  if (!value) return null;
  const agents = configuredAgentIds();
  if (agents.length === 0 || agents.includes(value)) return value;
  return null;
}

function llmRuntimeStatus() {
  let primary = null;
  let fallback = null;
  try {
    const p = primaryProvider();
    primary = p ? { id: p.id, model: providerModel(p) } : null;
  } catch (error) {
    primary = { error: error.message };
  }
  try {
    const f = fallbackProvider(primary?.id ? { id: primary.id } : null);
    fallback = f ? { id: f.id, model: providerModel(f) } : null;
  } catch (error) {
    fallback = { error: error.message };
  }
  return { primary, fallback, timeoutMs: process.env.AGENT_TASK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS };
}

app.get('/health', async (req, res) => {
  let db = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ok';
  } catch {
    db = 'error';
  }

  res.json({
    status: 'ok',
    time: Date.now(),
    db,
    redis: redis ? 'configured' : 'disabled',
    llm: llmRuntimeStatus(),
    providers: getProviderRuntimeStatus(),
    agents: getAgentRuntimeStatus(),
    agentsConfigured: (process.env.AGENTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean).length,
  });
});

// Safe, secret-free flag table for runtime/diagnostic endpoints.
function providerFlagTable() {
  return {
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    GOOGLE_AI_API_KEY: !!process.env.GOOGLE_AI_API_KEY,
    GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: !!process.env.OPENROUTER_API_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    TOGETHER_API_KEY: !!process.env.TOGETHER_API_KEY,
    MISTRAL_API_KEY: !!process.env.MISTRAL_API_KEY,
    CEREBRAS_API_KEY: !!process.env.CEREBRAS_API_KEY,
    ALCHEMY_API_KEY: !!process.env.ALCHEMY_API_KEY,
    COINGECKO_API_KEY: !!process.env.COINGECKO_API_KEY,
    CMC_API_KEY: !!process.env.CMC_API_KEY,
    TAVILY_API_KEY: !!process.env.TAVILY_API_KEY,
    SERPER_API_KEY: !!process.env.SERPER_API_KEY,
    modelOverrides: {
      GROQ_MODEL: process.env.GROQ_MODEL || null,
      GEMINI_MODEL: process.env.GEMINI_MODEL || null,
      CEREBRAS_MODEL: process.env.CEREBRAS_MODEL || null,
    },
    providerRouting: providerFallbackOrder(),
  };
}

app.get('/system/runtime', authMiddleware, async (req, res) => {
  const providerFlags = providerFlagTable();

  // Fleet status comes from agent heartbeats registered in Redis via
  // /api/coord/agents/register — never fabricated by index position. Agents
  // configured but not yet registered are reported as "configured".
  let registered = [];
  try {
    const raw = redis ? await redis.hgetall('agentfi:agents') : {};
    registered = Object.values(raw || {}).map((entry) => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    registered = [];
  }

  const configured = (process.env.AGENTS || process.env.NEXT_PUBLIC_AGENTS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const seen = new Set();
  const fleet = configured.map((name) => {
    const registration = registered.find((r) => r.agentId === name || r.name === name);
    seen.add(name);
    return {
      id: name,
      label: name,
      status: registration ? registration.status || 'online' : 'configured',
      registered: !!registration,
      registeredAt: registration?.registeredAt || null,
    };
  });
  for (const r of registered) {
    if (seen.has(r.agentId) || seen.has(r.name)) continue;
    seen.add(r.agentId);
    fleet.push({
      id: r.agentId,
      label: r.name || r.agentId,
      status: r.status || 'online',
      registered: true,
      registeredAt: r.registeredAt || null,
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user.sub } }).catch(() => null);
  const payoutRuntime = await payoutRuntimeSnapshot();
  const earnings = await computeUserEarnings(req.user.sub);

  res.json({
    providers: providerFlags,
    providerCount: Object.values(providerFlags).filter((v) => v === true).length,
    providerRuntime: getProviderRuntimeStatus(),
    agents: getAgentRuntimeStatus(),
    llm: llmRuntimeStatus(),
    redis: !!redis,
    queueEnabled: !!taskQueue,
    fleet,
    walletAddress: user?.walletAddress || null,
    walletProfiles: user?.walletProfiles || {},
    preferredNetwork: user?.preferredNetwork || 'ethereum',
    earnings,
    payoutRuntime,
    // What this deployment can and cannot do economically. Served next to the
    // runtime snapshot so a client never has to infer it from the numbers.
    economics: economicCapabilityReport({
      computeEconomyEnabled: process.env.REWARD_ECONOMY_ENABLED !== 'false',
      computeDemoMode: rewardEconomyEnabled() ? process.env.REWARD_DEMO_MODE === 'true' : false,
      paymentVerifierConfigured: false,
    }),
    earningsRateEth: earningRateEth(),
  });
});

app.get('/system/diagnostics', authMiddleware, async (req, res) => {
  let db = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ok';
  } catch {
    // Never surface raw database driver errors to clients.
    db = 'error';
  }

  const providerFlags = providerFlagTable();

  res.json({
    ok: true,
    time: Date.now(),
    db,
    redis: !!redis,
    queueEnabled: !!taskQueue,
    llm: llmRuntimeStatus(),
    providers: providerFlags,
    providerRuntime: getProviderRuntimeStatus(),
    agents: getAgentRuntimeStatus(),
    providerCount: Object.values(providerFlags).filter((v) => v === true).length,
    earningsRateEth: earningRateEth(),
    // Safe flags only; never API keys or other secrets.
    env: {
      NODE_ENV: process.env.NODE_ENV || 'development',
      PUBLISHER: typeof process.env.RENDER === 'string' ? 'render' : 'self-hosted',
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasRedisUrl: !!process.env.REDIS_URL,
    },
  });
});

app.get('/system/agents', authMiddleware, async (req, res) => {
  res.json({ ok: true, ...getAgentRuntimeStatus() });
});

// Provider health diagnostics. Without ?probe=1 this is configuration-derived
// (secret-free and instant). With ?probe=1 it performs a MINIMAL, bounded
// provider check (models-list round-trip) so reachability reflects reality.
// Values are preserved and never include credentials.
app.get('/system/providers', authMiddleware, async (req, res) => {
  const ids = ['groq', 'gemini', 'cerebras'];
  const out = {};
  for (const id of ids) {
    const spec = getProviderSpec(id);
    const configured = providerIsConfigured(spec);
    const entry = { provider: id, configured };
    if (configured && req.query.probe === '1') {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (spec.format === 'google') headers['x-goog-api-key'] = process.env[spec.keyEnv];
        else headers.Authorization = `Bearer ${process.env[spec.keyEnv]}`;
        const url = spec.format === 'google'
          ? `${spec.baseUrl}/models?key=${encodeURIComponent(process.env[spec.keyEnv])}`
          : `${spec.baseUrl.replace(/\/chat\/completions$/, '')}/models`;
        const res2 = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (res2.ok) {
          entry.reachability = 'reachable';
        } else {
          const category = String(res2.status === 402 ? 'payment_required' : 'unreachable');
          entry.reachability = category;
          entry.status = res2.status;
        }
      } catch {
        entry.reachability = 'unreachable';
      }
    } else if (configured) {
      entry.reachability = 'not-probed';
    }
    out[id] = entry;
  }
  res.json({ ok: true, providers: out, chain: providerFallbackOrder() });
});

app.post('/auth/register', registerLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    const trimmed = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim().toLowerCase() : null;

    const usernameError = validateUsername(trimmed);
    if (usernameError) return res.status(400).json({ error: usernameError });

    const emailError = validateEmail(email);
    if (emailError) return res.status(400).json({ error: emailError });

    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const existingUsername = await prisma.user.findUnique({ where: { username: trimmed } });
    if (existingUsername) return res.status(400).json({ error: 'Username is already taken.' });

    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return res.status(400).json({ error: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const ownerUsername = process.env.SUPER_ADMIN_USERNAME || 'okwedavid';
    const role = trimmed === ownerUsername ? ROLE_SUPER_ADMIN : defaultRole();

    const normalizedEmail = normalizeEmailAddress(email);
    const data = {
      username: trimmed,
      passwordHash,
      role,
    };
    if (normalizedEmail) {
      const verificationToken = issueEmailVerificationToken();
      data.email = normalizedEmail;
      data.emailVerified = false;
      data.emailVerificationToken = verificationToken;
      data.emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    const user = await prisma.user.create({ data });
    const session = await createSessionForUser(user.id);
    const token = signSessionToken(user, session);
    setSessionCookie(res, token);

    if (normalizedEmail) {
      const frontendBase = process.env.FRONTEND_BASE_URL
        || (process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',')[0].trim() : '')
        || 'https://agentfinance.onrender.com';
      void sendVerificationEmail({
        email: normalizedEmail,
        username: user.username,
        token: user.emailVerificationToken,
        baseUrl: frontendBase,
      }).catch(() => {});
    }

    res.json({
      ...serializeUser(user, { isNewUser: true }),
      token,
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'That username or email is already in use.' });
    }
    logger.error('register error', error);
    res.status(500).json({ error: 'registration failed' });
  }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const session = await createSessionForUser(user.id);
    const token = signSessionToken(user, session);

    // The session is delivered as an HttpOnly cookie, so it is not readable by
    // any script on the page. `token` is still returned in the body for
    // non-browser clients and for the WebSocket handshake, which has no cookie
    // jar; the frontend does not persist it.
    setSessionCookie(res, token);
    res.json({
      ...serializeUser(user, { isNewUser: false }),
      token,
    });
  } catch (error) {
    logger.error('login error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(serializeUser(user));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.patch('/auth/me', authMiddleware, async (req, res) => {
  try {
    const current = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!current) return res.status(404).json({ error: 'user not found' });

    const data = {};
    if (typeof req.body.displayName === 'string') data.displayName = req.body.displayName.trim().slice(0, 80) || null;
    if (typeof req.body.bio === 'string') data.bio = req.body.bio.trim().slice(0, 280) || null;
    if (typeof req.body.preferredNetwork === 'string') data.preferredNetwork = normalizeNetwork(req.body.preferredNetwork).id;

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data,
    });

    res.json(serializeUser(updated));
  } catch (error) {
    logger.error('profile update error', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Logout revokes the session SERVER-SIDE and then clears the cookie.
//
// Both halves are required. Clearing only the cookie would leave the JWT valid
// for anyone who had captured it, and revoking only the session would leave the
// browser replaying a credential the server no longer honours. The previous
// implementation revoked the session but never cleared the cookie, so the
// browser kept presenting a dead token until the SPA removed it by hand.
app.post('/auth/logout', authMiddleware, async (req, res) => {
  try {
    if (req.sid) {
      await revokeSession(req.sid);
    }
    clearSessionCookieHeader(res);
    res.json({ ok: true });
  } catch (error) {
    logger.error('logout error', error);
    // Still clear the cookie on failure: the user asked to be signed out, and
    // leaving a cookie behind is the worse outcome.
    clearSessionCookieHeader(res);
    res.status(500).json({ error: 'failed' });
  }
});

// Account deletion must end every session, not just the current one. Otherwise
// a second tab, or a captured token, would remain authenticated against a
// deleted user until it happened to expire.
/**
 * POST /auth/ws-ticket — exchange the session cookie for a short-lived ticket
 * that the WebSocket handshake can carry.
 *
 * A browser cannot send cookies on a WebSocket handshake, so realtime auth needs
 * an explicit credential. This issues a ticket scoped to exactly that purpose
 * rather than handing the page its session JWT, which is what the previous build
 * did by keeping the full token in sessionStorage.
 *
 * The ticket is a separate short-lived JWT: it carries the session id, so
 * revoking the session (logout, account deletion) invalidates it immediately, and
 * it expires on its own in a minute.
 */
const WS_TICKET_TTL_SECONDS = 60;
app.post('/auth/ws-ticket', authMiddleware, async (req, res) => {
  try {
    const ticket = jwt.sign(
      { sub: req.user.sub, sid: req.sid, scope: 'ws' },
      JWT_SECRET,
      { expiresIn: `${WS_TICKET_TTL_SECONDS}s` },
    );
    res.json({ ticket, expiresIn: WS_TICKET_TTL_SECONDS });
  } catch (error) {
    logger.error('ws ticket error', error);
    res.status(500).json({ error: 'failed' });
  }
});

// Linked provider identities, so the user can see which accounts reach this
// profile. Exposes provider and email only - never a token or provider secret.
app.get('/auth/identities', authMiddleware, async (req, res) => {
  try {
    res.json({ identities: await listIdentitiesForUser(req.user.sub) });
  } catch (error) {
    logger.error('list identities error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/identities/unlink', authMiddleware, async (req, res) => {
  try {
    const result = await unlinkIdentity({ userId: req.user.sub, provider: req.body?.provider });
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    res.status(status).json({ error: status === 500 ? 'failed' : error.message });
  }
});

app.post('/auth/verify', verifyLimiter, async (req, res) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const result = await verifyEmailByToken(token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, email: result.email });
  } catch (error) {
    logger.error('email verify error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/verify', verifyLimiter, async (req, res) => {
  try {
    const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
    const result = await verifyEmailByToken(token);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, email: result.email });
  } catch (error) {
    logger.error('email verify error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/auth/email/provider', async (req, res) => {
  res.json(getEmailProviderStatus());
});

app.delete('/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(user.role))) {
      return res.status(400).json({ error: 'The owner/super admin account cannot be deleted.' });
    }

    const taskRows = await prisma.task.findMany({ where: { userId: user.id }, select: { id: true } });
    const taskIds = taskRows.map((task) => task.id);

    await prisma.$transaction([
      prisma.authSession.updateMany({ where: { userId: user.id }, data: { revoked: true } }),
      prisma.message.deleteMany({ where: { taskId: { in: taskIds } } }),
      prisma.task.deleteMany({ where: { userId: user.id } }),
      prisma.payout.deleteMany({ where: { userId: user.id } }),
      prisma.digitalProduct.deleteMany({ where: { userId: user.id } }),
      prisma.factoryRun.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    res.json({ ok: true, redirect: '/login' });
  } catch (error) {
    logger.error('delete account error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/promote', authMiddleware, requireRole([ROLE_SUPER_ADMIN]), async (req, res) => {
  try {
    const targetUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!targetUsername) return res.status(400).json({ error: 'username required' });

    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(target.role))) {
      return res.status(400).json({ error: 'The super admin account cannot be changed.' });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: ROLE_ADMIN },
    });

    res.json({ ok: true, user: updated });
  } catch (error) {
    logger.error('promote error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/demote', authMiddleware, requireRole([ROLE_SUPER_ADMIN]), async (req, res) => {
  try {
    const targetUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (!targetUsername) return res.status(400).json({ error: 'username required' });

    const target = await prisma.user.findUnique({ where: { username: targetUsername } });
    if (!target) return res.status(404).json({ error: 'user not found' });
    if (isSuperAdminRole(normalizeRole(target.role))) {
      return res.status(400).json({ error: 'The super admin account cannot be changed.' });
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: defaultRole() },
    });

    res.json({ ok: true, user: updated });
  } catch (error) {
    logger.error('demote error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/auth/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    const network = normalizeNetwork(req.body.network).id;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ error: 'user not found' });

    if (walletAddress !== null && walletAddress !== undefined) {
      if (typeof walletAddress !== 'string' || !isValidAddressForNetwork(walletAddress, normalizeNetwork(network))) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }
    }

    const profiles = user.walletProfiles && typeof user.walletProfiles === 'object'
      ? { ...user.walletProfiles }
      : {};

    if (walletAddress) {
      profiles[network] = walletAddress;
    } else {
      delete profiles[network];
    }

    const updated = await prisma.user.update({
      where: { id: req.user.sub },
      data: {
        walletAddress: walletAddress || null,
        walletProfiles: profiles,
        preferredNetwork: network,
      },
    });

    res.json({
      ok: true,
      walletAddress: updated.walletAddress,
      walletProfiles: updated.walletProfiles || {},
      preferredNetwork: updated.preferredNetwork || 'ethereum',
    });
  } catch (error) {
    logger.error('wallet save error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/tasks', authMiddleware, taskCreateLimiter, async (req, res) => {
  try {
    const { action } = req.body;
    const agentId = normalizeAgentTarget(req.body.agentId);
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }
    if (action.length > MAX_TASK_ACTION_LENGTH) {
      return res.status(400).json({ error: `Action is too long (max ${MAX_TASK_ACTION_LENGTH} characters).` });
    }

    await assertTaskCapacity(req.user.sub);

    const agentType = classifyAgent(action);
    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        action,
        status: 'queued',
        userId: req.user.sub,
        agentId,
      },
    });

    await publish('agentfi:tasks', {
      type: 'task:created',
      data: { id: task.id, status: 'queued', agentType },
      correlationId: task.id,
    });

    if (taskQueue) {
      await taskQueue.remove(task.id).catch(() => {});
      await taskQueue.add(
        'processTask',
        { taskId: task.id, action, userId: req.user.sub, agentId },
        {
          jobId: task.id,
          attempts: 1,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
    } else {
      void executeAgentTask({
        taskId: task.id,
        action,
        userId: req.user.sub,
        agentId,
        publish: (type, data) => publish('agentfi:tasks', { type, data }),
      });
    }

    res.json(sanitizeTask(task));
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    logger.error('task create error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/tasks', authMiddleware, async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where: { userId: req.user.sub, archived: false },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(tasks.map(sanitizeTask));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!task) return res.status(404).json({ error: 'not found' });
    res.json(sanitizeTask(task));
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.patch('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    // Server-authoritative task lifecycle. The client may only archive a task
    // or cancel it while it is still waiting/running. It can NEVER write
    // status to completed/failed, nor write a result/completedAt — those are
    // produced exclusively by executeAgentTask on the server.
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const fields = {};
    if (typeof req.body.archived === 'boolean') fields.archived = req.body.archived;

    const requestedStatus = req.body.status;
    if (requestedStatus !== undefined) {
      const next = String(requestedStatus).toLowerCase();
      if (next !== 'cancelled') {
        return res.status(403).json({ error: 'Task status can only be changed to "cancelled" by the client.' });
      }
      const ACTIVE = new Set(['queued', 'pending', 'running', 'retrying']);
      if (!ACTIVE.has(existing.status)) {
        return res.status(409).json({ error: `A ${existing.status} task cannot be cancelled.` });
      }
      fields.status = 'cancelled';
      fields.completedAt = new Date();
    }

    if (
      req.body.result !== undefined ||
      req.body.completedAt !== undefined ||
      req.body.startedAt !== undefined ||
      req.body.duration !== undefined
    ) {
      return res.status(403).json({ error: 'Task results are written by the server only.' });
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    // Cancel/archive are persisted exactly as requested. They NEVER re-dispatch
    // a job: cancelling stops execution and archiving hides a task; retries go
    // through the explicit POST /tasks/:id/retry endpoint.
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: fields,
    });

    await publish('agentfi:tasks', { type: 'task:updated', data: sanitizeTask(task) });

    res.json(sanitizeTask(task));
  } catch (error) {
    logger.error('task patch error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/tasks/:id/retry', authMiddleware, taskCreateLimiter, async (req, res) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const RETRYABLE = new Set(['failed', 'cancelled', 'timed_out']);
    if (!RETRYABLE.has(existing.status)) {
      return res.status(409).json({ error: `Only failed or cancelled tasks can be retried (current: ${existing.status}).` });
    }

    if ((existing.retryCount || 0) >= MAX_TASK_RETRIES) {
      return res.status(429).json({ error: `This task has reached its retry limit (${MAX_TASK_RETRIES}).` });
    }

    await assertTaskCapacity(req.user.sub);

    // Re-queue the SAME task row: the id, earnings history and result are
    // preserved/cleared in place — never a duplicate execution record.
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        duration: null,
        result: null,
        archived: false,
        retryCount: { increment: 1 },
      },
    });

    await publish('agentfi:tasks', { type: 'task:updated', data: sanitizeTask(task) });

    const jobData = {
      taskId: task.id,
      action: task.action,
      userId: task.userId,
      agentId: task.agentId || null,
    };

    if (taskQueue) {
      // jobId === task.id: a single idempotent job per task row, so the worker
      // recovery sweep can inspect the exact job responsible for this task.
      // The previous job (if any) is removed first so retries re-enqueue rather
      // than being swallowed by BullMQ's jobId unicity rule.
      await taskQueue.remove(task.id).catch(() => {});
      await taskQueue.add('processTask', jobData, {
        jobId: task.id,
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      });
      await publish('agentfi:tasks', { type: 'task:queued', data: sanitizeTask(task) });
    } else {
      void executeAgentTask({
        ...jobData,
        publish: (type, data) => publish('agentfi:tasks', { type, data }),
      });
    }

    res.json(sanitizeTask(task));
  } catch (error) {
    logger.error('task retry error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.sub },
    });
    if (!existing) return res.status(404).json({ error: 'not found' });

    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: { archived: true },
    });
    await publish('agentfi:tasks', { type: 'task:deleted', data: { id: task.id } });
    res.json({ ok: true, id: task.id });
  } catch {
    res.status(500).json({ error: 'failed' });
  }
});

app.delete('/tasks/all', authMiddleware, async (req, res) => {
  try {
    const result = await prisma.task.updateMany({
      where: { userId: req.user.sub, archived: false },
      data: { archived: true },
    });
    await publish('agentfi:tasks', { type: 'task:cleared', data: { deleted: result.count, userId: req.user.sub } });
    res.json({ deleted: result.count, ok: true });
  } catch (error) {
    logger.error('bulk delete error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/payouts/prepare', authMiddleware, payoutLimiter, async (req, res) => {
  try {
    const network = normalizeNetwork(req.body.network).id;
    const amount = req.body.amount;
    const recipientAddress = req.body.recipientAddress || null;
    const sourceAction = typeof req.body.action === 'string' && req.body.action.trim()
      ? req.body.action.trim()
      : `Prepare routing plan for ${amount} on ${network}.`;

    const task = await prisma.task.create({
      data: {
        id: uuidv4(),
        action: sourceAction,
        status: 'running',
        userId: req.user.sub,
      },
    });

    await publish('agentfi:tasks', { type: 'task:created', data: sanitizeTask(task) });
    await publish('agentfi:tasks', { type: 'task:running', data: sanitizeTask(task) });

    const payout = await preparePayoutPlan({
      userId: req.user.sub,
      taskId: task.id,
      network,
      amount,
      recipientAddress,
    });

    const completedTask = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: payout.status === 'blocked' ? 'failed' : 'completed',
        completedAt: new Date(),
        result: JSON.stringify({
          summary: payout.summary,
          payoutId: payout.id,
          network: payout.network,
          payoutStatus: payout.status,
        }),
      },
    });

    await publish('agentfi:tasks', {
      type: payout.status === 'blocked' ? 'task:failed' : 'task:completed',
      data: sanitizeTask(completedTask),
    });

    res.json({
      payout,
      task: sanitizeTask(completedTask),
    });
  } catch (error) {
    logger.error('prepare payout error', error);

    // Never leave the helper task stuck in 'running' when preparation fails
    // (e.g. insufficient settleable balance under the reward economy).
    try {
      await prisma.task.update({
        where: { id: task?.id },
        data: { status: 'failed', completedAt: new Date(), result: JSON.stringify({ error: 'Payout preparation failed.', failureType: 'payout' }) },
      }).catch(() => null);
    } catch { /* best effort */ }

    const status = Number(error?.status) || 400;
    res.status(status).json({
      error: error?.message || 'Could not prepare payout.',
      ...(error?.payload || {}),
    });
  }
});

app.get('/payouts', authMiddleware, async (req, res) => {
  try {
    const payouts = await listPayouts(req.user.sub);
    res.json(payouts);
  } catch (error) {
    logger.error('list payouts error', error);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/payouts/:id/status', authMiddleware, async (req, res) => {
  try {
    const payout = await refreshPayoutStatus({ payoutId: req.params.id, userId: req.user.sub });
    res.json(payout);
  } catch (error) {
    logger.error('refresh payout status error', error);
    res.status(400).json({ error: error.message || 'Could not refresh payout status.' });
  }
});

app.get('/payouts/admin/queue', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const queue = await listPayoutsForAdmin();
    res.json(queue);
  } catch (error) {
    logger.error('admin payout queue error', error);
    res.status(500).json({ error: 'Could not load the payout queue.' });
  }
});

// The approval token is a bearer credential for treasury broadcast. The queue
// no longer returns it, so the approval screen fetches exactly one payout here
// and only when an admin actually opens it. Narrowing the credential from "every
// row in the queue" to "one row on demand" is the point: previously any client
// able to read a payout list also held the power to move real funds.
app.get('/payouts/:id/approval', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payout = await getPayoutForApproval(req.params.id);
    res.json({
      id: payout.id,
      status: payout.status,
      network: payout.network,
      assetSymbol: payout.assetSymbol,
      amount: payout.amount,
      recipientAddress: payout.recipientAddress,
      treasuryAddress: payout.treasuryAddress,
      txHash: payout.txHash,
      summary: payout.summary,
      approvalToken: payout.approvalToken || null,
    });
  } catch (error) {
    logger.error('payout approval detail error', error);
    res.status(error.status || 500).json({ error: error.message || 'Could not load the payout.' });
  }
});

app.post('/payouts/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payout = await approvePayout({
      payoutId: req.params.id,
      userId: req.user.sub,
      approvalToken: req.body?.approvalToken,
      actorRole: req.userRole,
    });
    res.json(payout);
  } catch (error) {
    logger.error('approve payout error', error);
    const message = typeof error?._raw === 'string' ? `The transaction could not be broadcast: ${error.message}` : (error.message || 'Could not approve payout.');
    const status = error.status || 400;
    res.status(status).json({ error: message });
  }
});

app.post('/payouts/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const payout = await rejectPayout({
      payoutId: req.params.id,
      userId: req.user.sub,
      actorRole: req.userRole,
      reason: req.body?.reason,
    });
    res.json(payout);
  } catch (error) {
    logger.error('reject payout error', error);
    const status = error.status || 400;
    res.status(status).json({ error: error.message || 'Could not reject payout.' });
  }
});

app.use('/analytics', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/wallet', walletRouter);
app.use('/auth/oauth', oauthRouter);

try {
  const factoryRouter = (await import('./routes/factory.js')).default;
  app.use('/api/factory', factoryLimiter, factoryRouter);
  app.use('/factory', factoryLimiter, factoryRouter);
  logger.info('Factory router mounted at /api/factory');
} catch (error) {
  logger.warn(`Factory router not found: ${error.message}`);
}

try {
  const coordinatorRouter = (await import('./routes/coordinator.js')).default;
  app.use('/api/coord', factoryLimiter, coordinatorRouter);
} catch (error) {
  logger.warn(`Coordinator router not found: ${error.message}`);
}

try {
  const agentsRouter = (await import('./routes/agents.js')).default;
  app.use('/agents', agentsRouter);
} catch (error) {
  logger.warn(`Agents router not found: ${error.message}`);
}

try {
  const dispatchRouter = typeof dispatchFactory === 'function'
    ? dispatchFactory({ redis })
    : (dispatchFactory.default || dispatchFactory);
  // authMiddleware runs first so the limiter can key on the resolved user id.
  if (dispatchRouter) app.use('/api/dispatch', authMiddleware, dispatchLimiter, dispatchRouter);
} catch (error) {
  logger.warn(`Dispatch router failed: ${error.message}`);
}

try {
  const sessionsRouter = typeof sessionsFactory === 'function'
    ? sessionsFactory({ redis })
    : (sessionsFactory.default || sessionsFactory);
  if (sessionsRouter) app.use('/api/sessions', sessionsRouter);
} catch (error) {
  logger.warn(`Sessions router failed: ${error.message}`);
}

try {
  const rewardsRoutes = (await import('./routes/rewards.js')).default;
  const { rewards: rewardsRouter, adminRewards: adminRewardsRouter } = rewardsRoutes();
  app.use('/api/rewards', rewardsRouter);
  app.use('/api/admin/rewards', adminRewardsRouter);
} catch (error) {
  logger.warn(`Rewards router failed: ${error.message}`);
}

try {
  const computeRoutes = (await import('./routes/compute.js')).default;
  const { compute: computeRouter, adminCompute: adminComputeRouter } = computeRoutes();
  app.use('/api/compute', computeRouter);
  app.use('/api/admin/compute', adminComputeRouter);
  logger.info('Compute-to-revenue router mounted at /api/compute');
} catch (error) {
  logger.warn(`Compute router failed: ${error.message}`);
}

app.use(errorHandler);

let subscriber = null;

if (REDIS_URL) {
  subscriber = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  subscriber.subscribe('agentfi:tasks', 'agentfi:agents', 'agentfi:compute', (error, count) => {
    if (error) logger.error(`Redis subscribe error: ${error.message}`);
    else logger.info(`Subscribed to ${count} Redis channels`);
  });

  subscriber.on('message', (channel, message) => {
    // Deliver task/compute events ONLY to sockets authenticated as the owning
    // user; fleet/factories events are broadcast to authenticated sockets.
    let scope = null;
    try {
      const parsed = JSON.parse(message);
      if (channel === 'agentfi:tasks' || channel === 'agentfi:compute') {
        scope = parsed?.data?.userId || null;
      }
    } catch {
      return;
    }
    wss.clients.forEach((client) => {
      if (client.readyState !== 1 || !client.userId) return;
      if (scope && client.userId !== scope) return;
      try {
        client.send(message);
      } catch {
        /* socket is closing; ignore */
      }
    });
  });
}

const WS_AUTH_TIMEOUT_MS = 10000;
const WS_HEARTBEAT_INTERVAL_MS = 30000;
const MAX_WS_PER_USER = 3;

/**
 * Verify a WebSocket ticket.
 *
 * A ticket must carry `scope: 'ws'`. Without that check a stolen session JWT
 * could be replayed straight into the WebSocket handshake and skip the short
 * lifetime the ticket exists to impose. The session lookup underneath is the
 * same one HTTP auth uses, so logout and account deletion invalidate tickets too.
 */
function resolveWsTicket(ticket) {
  if (!ticket || !JWT_SECRET) return Promise.resolve(null);
  let payload;
  try {
    payload = jwt.verify(ticket, JWT_SECRET);
  } catch {
    return Promise.resolve(null);
  }
  if (payload?.scope !== 'ws' || !payload?.sid || !payload?.sub) return Promise.resolve(null);
  // resolveUserFromToken verifies the signature and checks the session row, so
  // it accepts the ticket (same shape, same secret). The user id is taken from
  // the verified payload rather than the raw input.
  return resolveUserFromToken(ticket).then((resolved) => {
    if (!resolved) return null;
    return { id: resolved.user.sub, sid: resolved.sid };
  });
}

wss.on('connection', (ws, req) => {
  logger.info(`WebSocket client connected from ${req.socket.remoteAddress}`);

  // Unauthenticated sockets get a short window to present a WS TICKET in their
  // FIRST message ({ type: 'auth', ticket }). The ticket never travels in the
  // query string, and it is not the session JWT: a browser cannot attach cookies
  // to a WebSocket handshake, so it exchanges its session for a one-minute,
  // session-bound ticket via POST /auth/ws-ticket.
  ws.isAuthenticated = false;
  ws.isAlive = true;
  ws.userId = null;

  const authTimer = setTimeout(() => {
    if (!ws.isAuthenticated) ws.close(4001, 'Authentication required');
  }, WS_AUTH_TIMEOUT_MS);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buffer) => {
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString());
    } catch {
      return;
    }
    if (!ws.isAuthenticated) {
      if (parsed?.type === 'auth' && typeof parsed.ticket === 'string') {
        resolveWsTicket(parsed.ticket)
          .then((user) => {
            if (!user) return ws.close(4001, 'Authentication failed');
            let count = 0;
            for (const client of wss.clients) {
              if (client.userId === user.id) count += 1;
            }
            if (count >= MAX_WS_PER_USER) {
              return ws.close(4002, 'Too many connections');
            }
            ws.userId = user.id;
            ws.isAuthenticated = true;
            clearTimeout(authTimer);
            ws.send(JSON.stringify({ type: 'auth:ok' }));
          })
          .catch(() => ws.close(4001, 'Authentication failed'));
      }
      return;
    }
    // Authenticated clients may send ping/pong keepalives; other messages are
    // ignored (control plane is server-driven).
    if (parsed?.type === 'pong') ws.isAlive = true;
  });

  ws.on('error', (error) => logger.error(`WS error: ${error.message}`));
  ws.on('close', () => logger.info('WebSocket client disconnected'));
});

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    try {
      client.ping();
    } catch {
      /* socket is closing; ignore */
    }
  });
}, WS_HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref?.();

const PORT = process.env.PORT || 4000;

// Bootstrap admin role from server-side env config (never from the client).
bootstrapRun().catch((error) => logger.error(`Admin bootstrap failed: ${error.message}`));

// Reward economy: materialize the single RewardPool aggregate row at boot so
// every pool endpoint has a deterministic row to read (lazy by design).
ensureRewardPool()
  .then(() => logger.info('[rewards] reward pool ready'))
  .catch((error) => logger.warn(`[rewards] pool warm-up skipped: ${error.message}`));

// Compute economy: seed the server-managed service catalog additively (never a
// delete; a concurrent boot may win the race, which is safe).
ensureComputeServiceCatalog()
  .then(({ seeded, total }) => {
    if (total > 0) logger.info(`[compute] catalog ready (${total} services, ${seeded} seeded)`);
  })
  .catch((error) => logger.warn(`[compute] catalog warm-up skipped: ${error.message}`));

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Redis: ${redis ? 'connected' : 'disabled'}`);
  logger.info(`Queue: ${taskQueue ? 'enabled' : 'inline mode'}`);
});

// Graceful shutdown: stop accepting connections, drain the HTTP server, close
// WebSocket clients, then release Redis / BullMQ / Prisma resources.
function shutdown(signal) {
  logger.info(`Received ${signal}; shutting down gracefully`);
  clearInterval(heartbeatInterval);

  const forceExit = setTimeout(() => {
    logger.warn('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 15000);
  forceExit.unref();

  server.close(() => {
    (async () => {
      wss.clients.forEach((client) => client.terminate());
      try { if (subscriber) await subscriber.quit(); } catch { /* noop */ }
      try { if (redis && typeof redis.quit === 'function') await redis.quit(); } catch { /* noop */ }
      try { if (taskQueue && typeof taskQueue.close === 'function') await taskQueue.close(); } catch { /* noop */ }
      try { await prisma.$disconnect(); } catch { /* noop */ }
      logger.info('Shutdown complete');
      process.exit(0);
    })();
  });

  // Do not let keep-alive HTTP connections stall shutdown.
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
