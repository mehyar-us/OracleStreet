import assert from 'node:assert/strict';
import test from 'node:test';
import { listAuditLog, recordAuditEvent, resetAuditLogForTests } from '../lib/auditLog.js';

test('audit log records sanitized events without sensitive fields', () => {
  resetAuditLogForTests();
  const event = recordAuditEvent({
    action: 'test_action',
    actorEmail: 'admin@example.test',
    target: 'target@example.test',
    status: 'ok',
    details: { password: 'secret', token: 'token', safe: 'value' }
  });
  assert.equal(event.id, 'aud_000001');
  assert.equal(event.details.safe, 'value');
  assert.equal('password' in event.details, false);
  assert.equal('token' in event.details, false);

  const listed = listAuditLog();
  assert.equal(listed.count, 1);
  assert.equal(JSON.stringify(listed).includes('secret'), false);
});
