import crypto from 'node:crypto';
import { validateContactImport } from './lib/contacts.js';
import { dryRunSend, getEmailProviderConfig, validatePowerMtaConfig, validateSelectedProviderConfig } from './lib/emailProvider.js';
import { listMigrations } from './lib/migrations.js';

const SESSION_COOKIE = 'oraclestreet_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

const jsonResponse = (res, status, payload, headers = {}) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const base64url = (value) => Buffer.from(value).toString('base64url');
const unbase64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

const sessionSecret = () => process.env.ORACLESTREET_SESSION_SECRET || 'oraclestreet-dev-session-secret-change-me';

const sign = (payload) =>
  crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

const safeEqual = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const createSessionToken = (email) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({ email, iat: now, exp: now + SESSION_TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
};

const parseCookies = (header = '') => Object.fromEntries(
  header
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf('=');
      if (index === -1) return [entry, ''];
      return [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
    })
);

const getSession = (req) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(unbase64url(payload));
    if (!session.email || !session.exp || session.exp < Math.floor(Date.now() / 1000)) return null;
    return { email: session.email, expiresAt: new Date(session.exp * 1000).toISOString() };
  } catch {
    return null;
  }
};

const adminEmail = () => process.env.ORACLESTREET_ADMIN_EMAIL || 'admin@oraclestreet.local';
const adminPassword = () => process.env.ORACLESTREET_ADMIN_PASSWORD;

const requireMethod = (req, res, method) => {
  if (req.method === method) return true;
  jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' }, { allow: method });
  return false;
};

const requireSession = (req, res) => {
  const session = getSession(req);
  if (!session) {
    jsonResponse(res, 401, { ok: false, error: 'unauthorized' });
    return null;
  }
  return session;
};

const dashboardSummary = (session) => ({
  ok: true,
  user: { email: session.email },
  summary: {
    contacts: 0,
    segments: 0,
    templates: 0,
    campaigns: 0,
    queuedSends: 0,
    emailProvider: process.env.ORACLESTREET_MAIL_PROVIDER || 'dry-run',
    sendMode: 'safe-test-only'
  },
  safetyGates: {
    consentTracking: 'planned',
    suppressions: 'planned',
    unsubscribe: 'planned',
    bounceComplaints: 'planned',
    rateLimits: 'planned',
    auditLogs: 'planned',
    realSendingAllowed: false
  }
});

export const createHandler = () => {
  return async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return jsonResponse(res, 200, {
        ok: true,
        service: 'oraclestreet-backend',
        scope: 'affiliate-email-cms',
        emailProvider: process.env.ORACLESTREET_MAIL_PROVIDER || 'dry-run',
        auth: 'admin-session',
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/api/email/config' || url.pathname === '/email/config') {
      const config = getEmailProviderConfig();
      return jsonResponse(res, 200, {
        ok: true,
        ...config,
        powerMtaValidation: validatePowerMtaConfig()
      });
    }

    if (url.pathname === '/api/auth/session' || url.pathname === '/auth/session') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = getSession(req);
      return jsonResponse(res, 200, { ok: true, authenticated: Boolean(session), user: session ? { email: session.email } : null, expiresAt: session?.expiresAt || null });
    }

    if (url.pathname === '/api/auth/login' || url.pathname === '/auth/login') {
      if (!requireMethod(req, res, 'POST')) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      if (!adminPassword()) return jsonResponse(res, 503, { ok: false, error: 'admin_not_bootstrapped' });
      if (body.email !== adminEmail() || body.password !== adminPassword()) {
        return jsonResponse(res, 401, { ok: false, error: 'invalid_credentials' });
      }
      const token = createSessionToken(adminEmail());
      return jsonResponse(res, 200, { ok: true, user: { email: adminEmail() } }, {
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
      });
    }

    if (url.pathname === '/api/auth/logout' || url.pathname === '/auth/logout') {
      if (!requireMethod(req, res, 'POST')) return;
      return jsonResponse(res, 200, { ok: true }, {
        'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
      });
    }

    if (url.pathname === '/api/dashboard' || url.pathname === '/dashboard') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, dashboardSummary(session));
    }

    if (url.pathname === '/api/schema/migrations' || url.pathname === '/schema/migrations') {
      if (!requireMethod(req, res, 'GET')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, { ok: true, migrations: listMigrations() });
    }

    if (url.pathname === '/api/contacts/import/validate' || url.pathname === '/contacts/import/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = validateContactImport(body.contacts);
      return jsonResponse(res, result.error ? 400 : 200, result);
    }

    if (url.pathname === '/api/email/test-send' || url.pathname === '/email/test-send') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJsonBody(req);
      if (body === null) return jsonResponse(res, 400, { ok: false, error: 'invalid_json' });
      const result = dryRunSend(body);
      return jsonResponse(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/email/provider/validate' || url.pathname === '/email/provider/validate') {
      if (!requireMethod(req, res, 'POST')) return;
      const session = requireSession(req, res);
      if (!session) return;
      return jsonResponse(res, 200, {
        ok: true,
        validation: validateSelectedProviderConfig(),
        safeDefault: 'network_probe_skipped_no_delivery'
      });
    }

    return jsonResponse(res, 404, {
      ok: false,
      error: 'not_found',
      message: 'OracleStreet API baseline is running.'
    });
  };
};
