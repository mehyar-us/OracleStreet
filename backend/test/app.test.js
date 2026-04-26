import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createHandler } from '../app.js';

const request = async (path, options = {}) => {
  const server = http.createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, options);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const withEnv = async (updates, fn) => {
  const originals = Object.fromEntries(Object.keys(updates).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('health endpoint returns OracleStreet service metadata', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.service, 'oraclestreet-backend');
  assert.equal(res.body.scope, 'affiliate-email-cms');
  assert.equal(res.body.auth, 'admin-session');
});

test('email config endpoint defaults to dry-run safe mode', async () => {
  await withEnv({ ORACLESTREET_MAIL_PROVIDER: undefined, ORACLESTREET_REAL_EMAIL_ENABLED: undefined }, async () => {
    const res = await request('/api/email/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, 'dry-run');
    assert.equal(res.body.sendMode, 'safe-test-only');
    assert.equal(res.body.realSendingEnabled, false);
  });
});

test('auth session reports unauthenticated without a cookie', async () => {
  const res = await request('/api/auth/session');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
  assert.equal(res.body.user, null);
});

test('admin login rejects requests before bootstrap password exists', async () => {
  await withEnv({ ORACLESTREET_ADMIN_PASSWORD: undefined }, async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@oraclestreet.local', password: 'anything' })
    });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'admin_not_bootstrapped');
  });
});

test('admin login creates an http-only session cookie', async () => {
  await withEnv({
    ORACLESTREET_ADMIN_EMAIL: 'admin@example.test',
    ORACLESTREET_ADMIN_PASSWORD: 'correct-horse-battery-staple',
    ORACLESTREET_SESSION_SECRET: 'test-secret-at-least-stable'
  }, async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'correct-horse-battery-staple' })
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'admin@example.test');
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /oraclestreet_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const session = await request('/api/auth/session', { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.user.email, 'admin@example.test');
  });
});

test('admin login rejects invalid credentials', async () => {
  await withEnv({ ORACLESTREET_ADMIN_PASSWORD: 'right-password' }, async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@oraclestreet.local', password: 'wrong-password' })
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_credentials');
  });
});

test('logout clears the session cookie', async () => {
  const res = await request('/api/auth/logout', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('unknown route returns JSON 404', async () => {
  const res = await request('/missing');
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'not_found');
});


test('email config endpoint also works behind nginx stripped api prefix', async () => {
  const res = await request('/email/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'dry-run');
});

test('auth endpoints also work behind nginx stripped api prefix', async () => {
  const res = await request('/auth/session');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
});
