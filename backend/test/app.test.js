import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createHandler } from '../app.js';

const request = async (path) => {
  const server = http.createServer(createHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('health endpoint returns OracleStreet service metadata', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.service, 'oraclestreet-backend');
  assert.equal(res.body.scope, 'affiliate-email-cms');
});

test('email config endpoint defaults to dry-run safe mode', async () => {
  const originalProvider = process.env.ORACLESTREET_MAIL_PROVIDER;
  const originalReal = process.env.ORACLESTREET_REAL_EMAIL_ENABLED;
  delete process.env.ORACLESTREET_MAIL_PROVIDER;
  delete process.env.ORACLESTREET_REAL_EMAIL_ENABLED;
  try {
    const res = await request('/api/email/config');
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, 'dry-run');
    assert.equal(res.body.sendMode, 'safe-test-only');
    assert.equal(res.body.realSendingEnabled, false);
  } finally {
    if (originalProvider === undefined) delete process.env.ORACLESTREET_MAIL_PROVIDER;
    else process.env.ORACLESTREET_MAIL_PROVIDER = originalProvider;
    if (originalReal === undefined) delete process.env.ORACLESTREET_REAL_EMAIL_ENABLED;
    else process.env.ORACLESTREET_REAL_EMAIL_ENABLED = originalReal;
  }
});

test('unknown route returns JSON 404', async () => {
  const res = await request('/missing');
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'not_found');
});
