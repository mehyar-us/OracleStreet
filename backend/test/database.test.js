import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseConfig, validateDatabaseConfig } from '../lib/database.js';

test('database config defaults to local PostgreSQL placeholder without secrets', () => {
  const result = validateDatabaseConfig({});
  assert.equal(result.ok, true);
  assert.equal(result.config.source, 'default-local-placeholder');
  assert.equal(result.config.parsed.host, 'localhost');
  assert.equal(result.config.parsed.database, 'oraclestreet');
  assert.equal(result.persistenceMode, 'in-memory-until-postgresql-connection-enabled');
});

test('database config redacts password and reports parsed connection fields', () => {
  const config = getDatabaseConfig({ ORACLESTREET_DATABASE_URL: 'postgresql://app:secret@db.example.test:6543/oraclestreet?sslmode=require' });
  assert.equal(config.configured, true);
  assert.equal(config.source, 'ORACLESTREET_DATABASE_URL');
  assert.equal(config.parsed.host, 'db.example.test');
  assert.equal(config.parsed.port, 6543);
  assert.equal(config.parsed.sslMode, 'require');
  assert.equal(config.redactedUrl.includes('secret'), false);
  assert.ok(config.redactedUrl.includes('***'));
});

test('database config validation rejects non-PostgreSQL URLs', () => {
  const result = validateDatabaseConfig({ ORACLESTREET_DATABASE_URL: 'mysql://app:secret@db.example.test/oraclestreet' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('postgres_protocol_required'));
});
