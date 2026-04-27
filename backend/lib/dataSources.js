import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { importContacts, validateContactImport } from './contacts.js';
import { isPgRepositoryEnabled, runLocalPgRows, sqlLiteral } from './localPg.js';

const dataSources = new Map();
const encryptedConnectionSecrets = new Map();
const syncRuns = new Map();
const importSchedules = new Map();
let sequence = 0;
let secretSequence = 0;
let syncRunSequence = 0;
let scheduleSequence = 0;

const nowIso = () => new Date().toISOString();

const redactUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return null;
  }
};

const parsePostgresUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, ''),
      usernameConfigured: Boolean(url.username),
      passwordConfigured: Boolean(url.password),
      sslMode: url.searchParams.get('sslmode') || 'not-specified'
    };
  } catch {
    return null;
  }
};

const cloneSource = (source) => ({
  ...source,
  connection: { ...source.connection, parsed: { ...source.connection.parsed } }
});

const cloneSyncRun = (run) => ({
  ...run,
  validation: { ...run.validation, requiredGates: [...run.validation.requiredGates], blockers: [...run.validation.blockers] },
  mapping: { ...run.mapping, fields: [...run.mapping.fields] }
});

const cloneImportSchedule = (schedule) => ({
  ...schedule,
  query: { ...schedule.query },
  mapping: { ...schedule.mapping, defaults: { ...schedule.mapping.defaults } },
  validation: { ...schedule.validation, requiredGates: [...schedule.validation.requiredGates], blockers: [...schedule.validation.blockers] },
  safety: { ...schedule.safety }
});

const safeParseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const pgDataSourceRows = () => runLocalPgRows(`
  SELECT id, name, type, status, coalesce(redacted_url, ''), parsed::text, secret_stored::text, secret_storage, coalesce(encrypted_connection_ref::text, ''), encryption::text, connection_probe, sync_enabled::text, coalesce(actor_email, ''), created_at::text, coalesce(updated_at::text, '')
  FROM data_source_registry
  ORDER BY created_at DESC
  LIMIT 1000;
`);

const pgRowToDataSource = ([id, name, type, status, redactedUrl, parsedJson, secretStored, secretStorage, encryptedRefJson, encryptionJson, connectionProbe, syncEnabled, actorEmail, createdAt, updatedAt]) => ({
  id,
  name,
  type,
  status,
  connection: {
    redactedUrl: redactedUrl || null,
    parsed: safeParseJson(parsedJson),
    secretStored: secretStored === 't' || secretStored === 'true',
    secretStorage: secretStorage || 'metadata-only',
    encryptedConnectionRef: encryptedRefJson ? safeParseJson(encryptedRefJson, null) : null,
    encryption: safeParseJson(encryptionJson, {}),
    connectionProbe: connectionProbe || 'skipped_registry_validation_only'
  },
  syncEnabled: syncEnabled === 't' || syncEnabled === 'true',
  actorEmail: actorEmail || null,
  createdAt,
  updatedAt: updatedAt || null
});

const listDataSourcesFromPostgres = () => pgDataSourceRows().map(pgRowToDataSource);

const getDataSourceFromPostgres = (id) => {
  const rows = runLocalPgRows(`
    SELECT id, name, type, status, coalesce(redacted_url, ''), parsed::text, secret_stored::text, secret_storage, coalesce(encrypted_connection_ref::text, ''), encryption::text, connection_probe, sync_enabled::text, coalesce(actor_email, ''), created_at::text, coalesce(updated_at::text, '')
    FROM data_source_registry
    WHERE id = ${sqlLiteral(id)}
    LIMIT 1;
  `);
  return rows[0] ? pgRowToDataSource(rows[0]) : null;
};

const saveDataSourceToPostgres = (source, secretRecord = null) => {
  if (secretRecord) {
    runLocalPgRows(`
      INSERT INTO data_source_encrypted_secrets (id, algorithm, iv, ciphertext, auth_tag, created_at)
      VALUES (${sqlLiteral(secretRecord.id)}, ${sqlLiteral(secretRecord.algorithm)}, ${sqlLiteral(secretRecord.iv)}, ${sqlLiteral(secretRecord.ciphertext)}, ${sqlLiteral(secretRecord.authTag)}, ${sqlLiteral(secretRecord.createdAt)})
      ON CONFLICT (id) DO UPDATE SET algorithm = EXCLUDED.algorithm, iv = EXCLUDED.iv, ciphertext = EXCLUDED.ciphertext, auth_tag = EXCLUDED.auth_tag;
    `);
  }
  const rows = runLocalPgRows(`
    INSERT INTO data_source_registry (id, name, type, status, redacted_url, parsed, secret_stored, secret_storage, encrypted_connection_ref, encryption, connection_probe, sync_enabled, actor_email, created_at, updated_at)
    VALUES (${[
      sqlLiteral(source.id),
      sqlLiteral(source.name),
      sqlLiteral(source.type),
      sqlLiteral(source.status),
      sqlLiteral(source.connection.redactedUrl),
      `${sqlLiteral(JSON.stringify(source.connection.parsed || {}))}::jsonb`,
      source.connection.secretStored ? 'true' : 'false',
      sqlLiteral(source.connection.secretStorage),
      source.connection.encryptedConnectionRef ? `${sqlLiteral(JSON.stringify(source.connection.encryptedConnectionRef))}::jsonb` : 'NULL',
      `${sqlLiteral(JSON.stringify(source.connection.encryption || {}))}::jsonb`,
      sqlLiteral(source.connection.connectionProbe),
      source.syncEnabled ? 'true' : 'false',
      sqlLiteral(source.actorEmail),
      sqlLiteral(source.createdAt),
      source.updatedAt ? sqlLiteral(source.updatedAt) : 'NULL'
    ].join(',')})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, status = EXCLUDED.status, redacted_url = EXCLUDED.redacted_url, parsed = EXCLUDED.parsed, secret_stored = EXCLUDED.secret_stored, secret_storage = EXCLUDED.secret_storage, encrypted_connection_ref = EXCLUDED.encrypted_connection_ref, encryption = EXCLUDED.encryption, connection_probe = EXCLUDED.connection_probe, sync_enabled = EXCLUDED.sync_enabled, actor_email = EXCLUDED.actor_email, updated_at = now()
    RETURNING id, name, type, status, coalesce(redacted_url, ''), parsed::text, secret_stored::text, secret_storage, coalesce(encrypted_connection_ref::text, ''), encryption::text, connection_probe, sync_enabled::text, coalesce(actor_email, ''), created_at::text, coalesce(updated_at::text, '');
  `);
  return pgRowToDataSource(rows[0]);
};

const getEncryptedSecretFromPostgres = (id) => {
  const rows = runLocalPgRows(`
    SELECT id, algorithm, iv, ciphertext, auth_tag, created_at::text
    FROM data_source_encrypted_secrets
    WHERE id = ${sqlLiteral(id)}
    LIMIT 1;
  `);
  if (!rows[0]) return null;
  const [secretId, algorithm, iv, ciphertext, authTag, createdAt] = rows[0];
  return { id: secretId, algorithm, iv, ciphertext, authTag, createdAt };
};

const getDataSource = (id) => {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  const memorySource = dataSources.get(cleanId);
  if (memorySource) return memorySource;
  if (isPgRepositoryEnabled('data_sources')) {
    try {
      const pgSource = getDataSourceFromPostgres(cleanId);
      if (pgSource) dataSources.set(pgSource.id, pgSource);
      return pgSource;
    } catch {
      return null;
    }
  }
  return null;
};

const pgRowToImportSchedule = ([id, dataSourceId, dataSourceName, status, enabled, intervalHours, nextRunPreviewAt, projectedSql, queryLimit, timeoutMs, mappingJson, validationJson, safetyJson, actorEmail, createdAt, updatedAt]) => ({
  id,
  dataSourceId,
  dataSourceName,
  status,
  enabled: enabled === 't' || enabled === 'true',
  intervalHours: Number(intervalHours || 0),
  nextRunPreviewAt,
  query: {
    projectedSql,
    limit: Number(queryLimit || 0),
    timeoutMs: Number(timeoutMs || 0),
    selectOnly: true
  },
  mapping: mappingJson ? JSON.parse(mappingJson) : { defaults: {} },
  validation: validationJson ? JSON.parse(validationJson) : { ok: true, requiredGates: [], blockers: [] },
  safety: safetyJson ? JSON.parse(safetyJson) : {},
  actorEmail: actorEmail || null,
  createdAt,
  updatedAt: updatedAt || null
});

const listImportSchedulesFromPostgres = () => runLocalPgRows(`
  SELECT id, data_source_id, data_source_name, status, enabled::text, interval_hours::text, next_run_preview_at::text, projected_sql, query_limit::text, timeout_ms::text, mapping::text, validation::text, safety::text, coalesce(actor_email, ''), created_at::text, coalesce(updated_at::text, '')
  FROM data_source_import_schedules
  ORDER BY created_at DESC
  LIMIT 1000;
`).map(pgRowToImportSchedule);

const saveImportScheduleToPostgres = (schedule) => {
  const rows = runLocalPgRows(`
    INSERT INTO data_source_import_schedules (id, data_source_id, data_source_name, status, enabled, interval_hours, next_run_preview_at, projected_sql, query_limit, timeout_ms, mapping, validation, safety, actor_email, created_at, updated_at)
    VALUES (${[
      sqlLiteral(schedule.id),
      sqlLiteral(schedule.dataSourceId),
      sqlLiteral(schedule.dataSourceName),
      sqlLiteral(schedule.status),
      schedule.enabled ? 'true' : 'false',
      Number(schedule.intervalHours || 0),
      sqlLiteral(schedule.nextRunPreviewAt),
      sqlLiteral(schedule.query.projectedSql),
      Number(schedule.query.limit || 0),
      Number(schedule.query.timeoutMs || 0),
      `${sqlLiteral(JSON.stringify(schedule.mapping))}::jsonb`,
      `${sqlLiteral(JSON.stringify(schedule.validation))}::jsonb`,
      `${sqlLiteral(JSON.stringify(schedule.safety))}::jsonb`,
      sqlLiteral(schedule.actorEmail),
      sqlLiteral(schedule.createdAt),
      schedule.updatedAt ? sqlLiteral(schedule.updatedAt) : 'NULL'
    ].join(',')})
    RETURNING id, data_source_id, data_source_name, status, enabled::text, interval_hours::text, next_run_preview_at::text, projected_sql, query_limit::text, timeout_ms::text, mapping::text, validation::text, safety::text, coalesce(actor_email, ''), created_at::text, coalesce(updated_at::text, '');
  `);
  return pgRowToImportSchedule(rows[0]);
};

const secretKeyMaterial = () => String(process.env.ORACLESTREET_DATA_SOURCE_SECRET_KEY || '').trim();

const encryptionReadiness = () => {
  const keyMaterial = secretKeyMaterial();
  const errors = [];
  if (!keyMaterial) errors.push('data_source_secret_key_required');
  if (keyMaterial && keyMaterial.length < 32) errors.push('data_source_secret_key_min_32_chars');
  return {
    ok: errors.length === 0,
    errors,
    configured: errors.length === 0,
    algorithm: 'aes-256-gcm',
    keySource: 'ORACLESTREET_DATA_SOURCE_SECRET_KEY'
  };
};

const deriveEncryptionKey = () => crypto.createHash('sha256').update(secretKeyMaterial()).digest();

const encryptConnectionSecret = (plainText) => {
  const readiness = encryptionReadiness();
  if (!readiness.ok) return { ok: false, errors: readiness.errors };

  const id = `ds_secret_${Date.now().toString(36)}_${(++secretSequence).toString().padStart(6, '0')}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(readiness.algorithm, deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const stored = {
    id,
    algorithm: readiness.algorithm,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: authTag.toString('base64url'),
    createdAt: nowIso()
  };
  encryptedConnectionSecrets.set(id, stored);
  return {
    ok: true,
    ref: id,
    stored,
    metadata: {
      ref: id,
      algorithm: readiness.algorithm,
      encryptedAt: stored.createdAt,
      ciphertextStored: true,
      plaintextReturned: false
    }
  };
};

const decryptConnectionSecret = (ref) => {
  const readiness = encryptionReadiness();
  if (!readiness.ok) return { ok: false, errors: readiness.errors };
  const cleanRef = String(ref || '').trim();
  let stored = encryptedConnectionSecrets.get(cleanRef);
  if (!stored && isPgRepositoryEnabled('data_sources')) {
    try {
      stored = getEncryptedSecretFromPostgres(cleanRef);
      if (stored) encryptedConnectionSecrets.set(stored.id, stored);
    } catch {
      stored = null;
    }
  }
  if (!stored) return { ok: false, errors: ['encrypted_connection_secret_not_found'] };
  try {
    const decipher = crypto.createDecipheriv(stored.algorithm, deriveEncryptionKey(), Buffer.from(stored.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(stored.authTag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    return { ok: true, plaintext };
  } catch {
    return { ok: false, errors: ['encrypted_connection_secret_decrypt_failed'] };
  }
};


const destructiveSqlPattern = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|analyze)\b/i;
const hasSelectPrefix = (sql) => /^\s*(select|with)\b/i.test(sql);
const hasLimit = (sql) => /\blimit\s+\d+\b/i.test(sql);
const liveExecutionEnabled = (env = process.env) => String(env.ORACLESTREET_REMOTE_PG_EXECUTION_ENABLED || '').trim().toLowerCase() === 'true';
const requiredRemoteApprovalPhrase = 'I_APPROVE_REMOTE_POSTGRESQL_READ_ONLY_EXECUTION';
const requiredRemoteContactImportApprovalPhrase = 'I_APPROVE_REMOTE_POSTGRESQL_CONTACT_IMPORT';
const requiredRemoteImportScheduleApprovalPhrase = 'I_APPROVE_REMOTE_POSTGRESQL_IMPORT_SCHEDULE_PLAN';
const quoteSqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const psqlEnvFromUrl = (rawUrl, env = process.env) => {
  const parsed = new URL(rawUrl);
  const sslMode = parsed.searchParams.get('sslmode') || 'require';
  return {
    ...env,
    PGHOST: parsed.hostname,
    PGPORT: String(parsed.port || 5432),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
    PGUSER: decodeURIComponent(parsed.username || ''),
    PGPASSWORD: decodeURIComponent(parsed.password || ''),
    PGSSLMODE: sslMode,
    PGCONNECT_TIMEOUT: '5'
  };
};

const runPsqlJson = ({ connectionUrl, sql, timeoutMs }) => {
  const wrappedSql = `select coalesce(jsonb_agg(row_to_json(__oraclestreet_remote_query)), '[]'::jsonb)::text from (${sql.replace(/;\s*$/, '')}) __oraclestreet_remote_query;`;
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', wrappedSql], {
    env: psqlEnvFromUrl(connectionUrl),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    return { ok: false, errors: [result.error?.code === 'ETIMEDOUT' ? 'remote_postgresql_query_timeout' : 'remote_postgresql_query_failed_redacted'] };
  }
  try {
    const rows = JSON.parse(String(result.stdout || '[]').trim() || '[]');
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch {
    return { ok: false, errors: ['remote_postgresql_result_parse_failed'] };
  }
};

const sourcePublicView = (source) => source ? { id: source.id, name: source.name, connection: { parsed: { ...source.connection.parsed }, secretStored: source.connection.secretStored } } : null;

const buildValidatedQueryPlan = ({ dataSourceId, sql, limit = 100, timeoutMs = 5000, explain = true, actorEmail = null }) => {
  const source = getDataSource(dataSourceId);
  const cleanSql = String(sql || '').trim();
  const parsedLimit = Number(limit);
  const parsedTimeoutMs = Number(timeoutMs);
  const errors = [];

  if (!source) errors.push('data_source_not_found');
  if (!cleanSql) errors.push('sql_required');
  if (cleanSql && !hasSelectPrefix(cleanSql)) errors.push('select_only_sql_required');
  if (cleanSql && destructiveSqlPattern.test(cleanSql)) errors.push('destructive_sql_rejected');
  if (cleanSql && /;\s*\S/.test(cleanSql)) errors.push('single_statement_required');
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) errors.push('valid_limit_1_500_required');
  if (!Number.isInteger(parsedTimeoutMs) || parsedTimeoutMs < 100 || parsedTimeoutMs > 10000) errors.push('valid_timeout_100_10000_ms_required');

  const projectedSql = cleanSql && hasLimit(cleanSql) ? cleanSql.replace(/;\s*$/, '') : `${cleanSql.replace(/;\s*$/, '')} LIMIT ${Number.isInteger(parsedLimit) ? parsedLimit : 100}`;

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      mode: 'data-source-select-query-safe-plan',
      realQuery: false,
      rowsReturned: 0,
      networkProbe: 'skipped',
      source: sourcePublicView(source)
    };
  }

  return {
    ok: true,
    mode: 'data-source-select-query-safe-plan',
    dataSourceId: source.id,
    sourceName: source.name,
    query: {
      originalSql: cleanSql,
      projectedSql,
      selectOnly: true,
      limit: parsedLimit,
      timeoutMs: parsedTimeoutMs,
      explain: Boolean(explain)
    },
    schemaDiscovery: {
      status: 'planned_no_network_probe',
      candidateTablesQuery: "select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' limit 100",
      candidateColumnsQuery: "select table_schema, table_name, column_name, data_type from information_schema.columns limit 500"
    },
    rows: [],
    rowsReturned: 0,
    rowsPulled: 0,
    realQuery: false,
    networkProbe: 'skipped_until_pg_driver_and_operator_approval',
    requiredGates: [
      'admin_session',
      'registered_postgresql_source',
      'encrypted_secret_ref',
      'select_only_sql',
      'bounded_limit',
      'bounded_timeout',
      'redacted_errors',
      'future_live_query_approval'
    ],
    blockers: source.connection.secretStored ? ['pg_driver_not_enabled', 'live_remote_query_disabled'] : ['encrypted_connection_secret_required', 'pg_driver_not_enabled', 'live_remote_query_disabled'],
    actorEmail,
    createdAt: nowIso()
  };
};

export const validateDataSourceQuery = (input) => buildValidatedQueryPlan(input);

export const executeDataSourceQuery = ({ approvalPhrase, ...input } = {}, env = process.env) => {
  const plan = buildValidatedQueryPlan(input);
  const blockers = [];
  if (!plan.ok) return plan;
  if (!liveExecutionEnabled(env)) blockers.push('remote_postgresql_execution_disabled');
  if (approvalPhrase !== requiredRemoteApprovalPhrase) blockers.push('exact_remote_read_only_approval_phrase_required');
  const source = getDataSource(input.dataSourceId);
  if (!source?.connection.secretStored) blockers.push('encrypted_connection_secret_required');
  const ref = source?.connection.encryptedConnectionRef?.ref;
  const decrypted = blockers.length === 0 ? decryptConnectionSecret(ref) : null;
  if (decrypted && !decrypted.ok) blockers.push(...decrypted.errors);
  if (blockers.length > 0) {
    return {
      ...plan,
      mode: 'data-source-select-query-live-gate',
      ok: false,
      errors: blockers,
      blockers,
      rows: [],
      rowsReturned: 0,
      rowsPulled: 0,
      realQuery: false,
      networkProbe: 'blocked_before_remote_connection',
      safety: {
        selectOnly: true,
        boundedLimit: true,
        boundedTimeout: true,
        redactedErrors: true,
        noSecretOutput: true,
        noDestructiveSql: true
      }
    };
  }

  const executed = runPsqlJson({ connectionUrl: decrypted.plaintext, sql: plan.query.projectedSql, timeoutMs: plan.query.timeoutMs });
  if (!executed.ok) {
    return {
      ...plan,
      mode: 'data-source-select-query-live-gate',
      ok: false,
      errors: executed.errors,
      blockers: executed.errors,
      rows: [],
      rowsReturned: 0,
      rowsPulled: 0,
      realQuery: false,
      networkProbe: 'attempted_with_redacted_error'
    };
  }

  return {
    ...plan,
    mode: 'data-source-select-query-live-gate',
    rows: executed.rows,
    rowsReturned: executed.rows.length,
    rowsPulled: executed.rows.length,
    realQuery: true,
    networkProbe: 'executed_read_only_via_psql_adapter',
    blockers: [],
    safety: {
      selectOnly: true,
      boundedLimit: true,
      boundedTimeout: true,
      redactedErrors: true,
      noSecretOutput: true,
      noDestructiveSql: true
    }
  };
};


const buildSchemaDiscoveryPlan = ({ dataSourceId, schemas = ['public'], tableLimit = 100, columnLimit = 500, timeoutMs = 5000, actorEmail = null }) => {
  const source = getDataSource(dataSourceId);
  const requestedSchemas = Array.isArray(schemas) ? schemas.map((schema) => String(schema || '').trim()).filter(Boolean) : [];
  const parsedTableLimit = Number(tableLimit);
  const parsedColumnLimit = Number(columnLimit);
  const parsedTimeoutMs = Number(timeoutMs);
  const errors = [];

  if (!source) errors.push('data_source_not_found');
  if (requestedSchemas.length === 0) errors.push('schema_allowlist_required');
  if (requestedSchemas.some((schema) => !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))) errors.push('valid_schema_names_required');
  if (!Number.isInteger(parsedTableLimit) || parsedTableLimit < 1 || parsedTableLimit > 500) errors.push('valid_table_limit_1_500_required');
  if (!Number.isInteger(parsedColumnLimit) || parsedColumnLimit < 1 || parsedColumnLimit > 2000) errors.push('valid_column_limit_1_2000_required');
  if (!Number.isInteger(parsedTimeoutMs) || parsedTimeoutMs < 100 || parsedTimeoutMs > 10000) errors.push('valid_timeout_100_10000_ms_required');

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      mode: 'data-source-schema-discovery-safe-plan',
      realProbe: false,
      realDiscovery: false,
      tablesReturned: 0,
      columnsReturned: 0,
      networkProbe: 'skipped',
      source: sourcePublicView(source)
    };
  }

  const quotedSchemas = requestedSchemas.map((schema) => quoteSqlLiteral(schema)).join(', ');
  return {
    ok: true,
    mode: 'data-source-schema-discovery-safe-plan',
    dataSourceId: source.id,
    sourceName: source.name,
    connection: {
      host: source.connection.parsed.host,
      port: source.connection.parsed.port,
      database: source.connection.parsed.database,
      sslMode: source.connection.parsed.sslMode,
      secretStored: source.connection.secretStored
    },
    discovery: {
      schemas: requestedSchemas,
      tableLimit: parsedTableLimit,
      columnLimit: parsedColumnLimit,
      timeoutMs: parsedTimeoutMs,
      tablesSql: `select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE' and table_schema in (${quotedSchemas}) order by table_schema, table_name limit ${parsedTableLimit}`,
      columnsSql: `select table_schema, table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema in (${quotedSchemas}) order by table_schema, table_name, ordinal_position limit ${parsedColumnLimit}`,
      samplePreviewSql: `select * from <schema>.<table> limit 25`
    },
    tables: [],
    columns: [],
    tablesReturned: 0,
    columnsReturned: 0,
    rowsPulled: 0,
    realProbe: false,
    realDiscovery: false,
    networkProbe: 'skipped_until_pg_driver_and_operator_approval',
    requiredGates: [
      'admin_session',
      'registered_postgresql_source',
      'encrypted_secret_ref',
      'schema_allowlist',
      'bounded_table_limit',
      'bounded_column_limit',
      'bounded_timeout',
      'redacted_errors',
      'future_live_probe_approval'
    ],
    blockers: source.connection.secretStored ? ['pg_driver_not_enabled', 'live_schema_discovery_disabled'] : ['encrypted_connection_secret_required', 'pg_driver_not_enabled', 'live_schema_discovery_disabled'],
    actorEmail,
    createdAt: nowIso()
  };
};

export const planDataSourceSchemaDiscovery = (input) => buildSchemaDiscoveryPlan(input);

export const executeDataSourceSchemaDiscovery = ({ approvalPhrase, ...input } = {}, env = process.env) => {
  const plan = buildSchemaDiscoveryPlan(input);
  const blockers = [];
  if (!plan.ok) return plan;
  if (!liveExecutionEnabled(env)) blockers.push('remote_postgresql_execution_disabled');
  if (approvalPhrase !== requiredRemoteApprovalPhrase) blockers.push('exact_remote_read_only_approval_phrase_required');
  const source = getDataSource(input.dataSourceId);
  if (!source?.connection.secretStored) blockers.push('encrypted_connection_secret_required');
  const ref = source?.connection.encryptedConnectionRef?.ref;
  const decrypted = blockers.length === 0 ? decryptConnectionSecret(ref) : null;
  if (decrypted && !decrypted.ok) blockers.push(...decrypted.errors);
  if (blockers.length > 0) {
    return {
      ...plan,
      mode: 'data-source-schema-discovery-live-gate',
      ok: false,
      errors: blockers,
      blockers,
      tables: [],
      columns: [],
      tablesReturned: 0,
      columnsReturned: 0,
      rowsPulled: 0,
      realProbe: false,
      realDiscovery: false,
      networkProbe: 'blocked_before_remote_connection'
    };
  }

  const tables = runPsqlJson({ connectionUrl: decrypted.plaintext, sql: plan.discovery.tablesSql, timeoutMs: plan.discovery.timeoutMs });
  if (!tables.ok) return { ...plan, mode: 'data-source-schema-discovery-live-gate', ok: false, errors: tables.errors, blockers: tables.errors, tables: [], columns: [], tablesReturned: 0, columnsReturned: 0, rowsPulled: 0, realProbe: false, realDiscovery: false, networkProbe: 'attempted_with_redacted_error' };
  const columns = runPsqlJson({ connectionUrl: decrypted.plaintext, sql: plan.discovery.columnsSql, timeoutMs: plan.discovery.timeoutMs });
  if (!columns.ok) return { ...plan, mode: 'data-source-schema-discovery-live-gate', ok: false, errors: columns.errors, blockers: columns.errors, tables: [], columns: [], tablesReturned: 0, columnsReturned: 0, rowsPulled: 0, realProbe: false, realDiscovery: false, networkProbe: 'attempted_with_redacted_error' };

  return {
    ...plan,
    mode: 'data-source-schema-discovery-live-gate',
    tables: tables.rows,
    columns: columns.rows,
    tablesReturned: tables.rows.length,
    columnsReturned: columns.rows.length,
    rowsPulled: 0,
    realProbe: true,
    realDiscovery: true,
    networkProbe: 'executed_read_only_via_psql_adapter',
    blockers: [],
    safety: {
      informationSchemaOnly: true,
      boundedTableLimit: true,
      boundedColumnLimit: true,
      boundedTimeout: true,
      redactedErrors: true,
      noSecretOutput: true
    }
  };
};

const rowValue = (row, key) => {
  if (!key) return '';
  if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lowerKey = String(key).toLowerCase();
  const found = Object.keys(row || {}).find((candidate) => candidate.toLowerCase() === lowerKey);
  return found ? row[found] : '';
};

export const previewContactImportFromDataSource = ({ rows, dataSourceId, sql, limit = 100, timeoutMs = 5000, approvalPhrase, mapping = {}, defaults = {}, actorEmail = null } = {}, env = process.env) => {
  let sourceRows = Array.isArray(rows) ? rows : null;
  let execution = null;
  const errors = [];

  if (!sourceRows && sql) {
    execution = executeDataSourceQuery({ dataSourceId, sql, limit, timeoutMs, approvalPhrase, actorEmail }, env);
    if (!execution.ok) {
      return {
        ok: false,
        mode: 'data-source-contact-import-preview',
        errors: execution.errors || execution.blockers || ['remote_query_execution_blocked'],
        blockers: execution.blockers || execution.errors || [],
        rowsSeen: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        realQuery: Boolean(execution.realQuery),
        rowsPulled: execution.rowsPulled || 0,
        importMutation: false
      };
    }
    sourceRows = execution.rows;
  }

  if (!Array.isArray(sourceRows)) errors.push('rows_or_approved_select_query_required');
  if (sourceRows && sourceRows.length > 500) errors.push('preview_row_limit_500_required');
  const emailColumn = String(mapping.email || 'email').trim();
  if (!emailColumn) errors.push('email_mapping_required');

  if (errors.length > 0) {
    return { ok: false, mode: 'data-source-contact-import-preview', errors, rowsSeen: sourceRows?.length || 0, acceptedCount: 0, rejectedCount: 0, realQuery: Boolean(execution?.realQuery), rowsPulled: execution?.rowsPulled || 0, importMutation: false };
  }

  const mappedContacts = sourceRows.map((row) => ({
    email: rowValue(row, emailColumn),
    consentStatus: rowValue(row, mapping.consentStatus || mapping.consent_status) || defaults.consentStatus || defaults.consent_status || 'opt_in',
    source: rowValue(row, mapping.source) || defaults.source || 'remote-postgresql-preview',
    sourceDetail: rowValue(row, mapping.sourceDetail || mapping.source_detail) || defaults.sourceDetail || defaults.source_detail || null,
    firstName: rowValue(row, mapping.firstName || mapping.first_name) || null,
    lastName: rowValue(row, mapping.lastName || mapping.last_name) || null
  }));
  const validation = validateContactImport(mappedContacts);

  return {
    ...validation,
    ok: true,
    mode: 'data-source-contact-import-preview',
    previewOk: validation.ok,
    rowsSeen: sourceRows.length,
    rowsPulled: execution?.rowsPulled || 0,
    realQuery: Boolean(execution?.realQuery),
    importMutation: false,
    source: dataSourceId ? sourcePublicView(getDataSource(dataSourceId)) : null,
    mapping: {
      email: emailColumn,
      consentStatus: mapping.consentStatus || mapping.consent_status || null,
      source: mapping.source || null,
      firstName: mapping.firstName || mapping.first_name || null,
      lastName: mapping.lastName || mapping.last_name || null,
      sourceDetail: mapping.sourceDetail || mapping.source_detail || null,
      defaultsApplied: {
        consentStatus: defaults.consentStatus || defaults.consent_status || 'opt_in',
        source: defaults.source || 'remote-postgresql-preview'
      }
    },
    sampleAccepted: validation.accepted.slice(0, 5),
    sampleRejected: validation.rejected.slice(0, 10),
    actorEmail,
    createdAt: nowIso()
  };
};

export const importContactsFromDataSource = ({ importApprovalPhrase, ...input } = {}, env = process.env) => {
  const preview = previewContactImportFromDataSource(input, env);
  const blockers = [];
  if (!preview.ok) blockers.push(...(preview.errors || ['import_preview_failed']));
  if (preview.ok && !preview.previewOk) blockers.push('import_preview_must_have_zero_rejected_rows');
  if (importApprovalPhrase !== requiredRemoteContactImportApprovalPhrase) blockers.push('exact_remote_contact_import_approval_phrase_required');
  if (blockers.length > 0) {
    return {
      ...preview,
      ok: false,
      mode: 'data-source-contact-import-approved-gate',
      errors: blockers,
      blockers,
      importedCount: 0,
      updatedCount: 0,
      importMutation: false,
      syncRun: null
    };
  }

  const imported = importContacts(preview.accepted, input.actorEmail || null);
  if (!imported.ok) {
    return {
      ...preview,
      ok: false,
      mode: 'data-source-contact-import-approved-gate',
      errors: imported.error ? [imported.error] : (imported.errors || ['contact_import_failed']),
      blockers: imported.error ? [imported.error] : (imported.errors || ['contact_import_failed']),
      importedCount: 0,
      updatedCount: 0,
      importMutation: false,
      syncRun: null
    };
  }

  const source = input.dataSourceId ? getDataSource(input.dataSourceId) : null;
  const run = {
    id: `sync_${(++syncRunSequence).toString().padStart(6, '0')}`,
    dataSourceId: source?.id || input.dataSourceId || null,
    dataSourceName: source?.name || 'manual-row-preview',
    status: 'imported_contacts',
    mode: 'data-source-contact-import-approved-gate',
    validation: {
      ok: true,
      requiredGates: [
        'admin_session',
        'contact_import_preview_passed',
        'exact_import_approval_phrase',
        'explicit_consent_and_source',
        'no_email_delivery'
      ],
      blockers: []
    },
    mapping: {
      status: 'contact_import_mapping_applied',
      fields: Object.entries(preview.mapping || {})
        .filter(([key, value]) => value && key !== 'defaultsApplied')
        .map(([key, value]) => `${key}:${value}`),
      contactFields: preview.mapping
    },
    rowsSeen: preview.rowsSeen,
    rowsImported: imported.importedCount || 0,
    rowsUpdated: imported.updatedCount || 0,
    rowsPulled: preview.rowsPulled || 0,
    realSync: Boolean(preview.realQuery),
    networkProbe: preview.realQuery ? 'read_only_select_executed_before_import' : 'not_required_for_supplied_rows',
    actorEmail: input.actorEmail || null,
    createdAt: nowIso(),
    finishedAt: nowIso()
  };
  syncRuns.set(run.id, run);

  return {
    ...preview,
    ok: true,
    mode: 'data-source-contact-import-approved-gate',
    previewOk: true,
    importedCount: imported.importedCount || 0,
    updatedCount: imported.updatedCount || 0,
    totalContacts: imported.totalContacts,
    imported: imported.imported || [],
    updated: imported.updated || [],
    persistenceMode: imported.persistenceMode,
    importMutation: true,
    realDeliveryAllowed: false,
    syncRun: cloneSyncRun(run)
  };
};

export const resetDataSourcesForTests = () => {
  dataSources.clear();
  encryptedConnectionSecrets.clear();
  syncRuns.clear();
  importSchedules.clear();
  sequence = 0;
  secretSequence = 0;
  syncRunSequence = 0;
  scheduleSequence = 0;
};

export const validateDataSource = ({ name, type = 'postgresql', connectionUrl, storeSecret = false }) => {
  const cleanName = String(name || '').trim();
  const cleanType = String(type || '').trim().toLowerCase();
  const rawUrl = String(connectionUrl || '').trim();
  const parsed = parsePostgresUrl(rawUrl);
  const errors = [];

  if (!cleanName) errors.push('data_source_name_required');
  if (cleanType !== 'postgresql') errors.push('postgresql_source_type_required');
  if (!parsed) errors.push('valid_postgresql_url_required');
  else {
    if (!['postgresql', 'postgres'].includes(parsed.protocol)) errors.push('postgres_protocol_required');
    if (!parsed.host) errors.push('database_host_required');
    if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) errors.push('valid_database_port_required');
    if (!parsed.database) errors.push('database_name_required');
    if (!parsed.usernameConfigured) errors.push('database_username_required');
  }

  const encryption = encryptionReadiness();
  if (storeSecret && !encryption.ok) errors.push(...encryption.errors);

  return {
    ok: errors.length === 0,
    errors,
    source: {
      name: cleanName,
      type: cleanType,
      connection: {
        redactedUrl: redactUrl(rawUrl),
        parsed,
        secretStored: false,
        secretStorage: storeSecret ? 'encrypted-secret-baseline' : 'metadata-only',
        encryptedConnectionRef: null,
        encryption: {
          configured: encryption.configured,
          algorithm: encryption.algorithm,
          keySource: encryption.keySource
        },
        connectionProbe: 'skipped_registry_validation_only'
      }
    }
  };
};

export const createDataSource = ({ name, type = 'postgresql', connectionUrl, storeSecret = false, actorEmail = null }) => {
  const validation = validateDataSource({ name, type, connectionUrl, storeSecret });
  if (!validation.ok) return { ok: false, errors: validation.errors, source: validation.source };

  let encryptedSecret = null;
  if (storeSecret) {
    encryptedSecret = encryptConnectionSecret(connectionUrl);
    if (!encryptedSecret.ok) return { ok: false, errors: encryptedSecret.errors, source: validation.source };
  }

  const source = {
    id: `ds_${Date.now().toString(36)}_${(++sequence).toString().padStart(6, '0')}`,
    name: validation.source.name,
    type: validation.source.type,
    status: 'registered_safe',
    connection: {
      ...validation.source.connection,
      secretStored: Boolean(encryptedSecret?.ok),
      encryptedConnectionRef: encryptedSecret?.metadata || null
    },
    syncEnabled: false,
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  let savedSource = source;
  let persistenceMode = 'in-memory-until-postgresql-connection-enabled';
  if (isPgRepositoryEnabled('data_sources')) {
    try {
      savedSource = saveDataSourceToPostgres(source, encryptedSecret?.stored || null);
      persistenceMode = 'postgresql-local-psql-repository';
    } catch {
      persistenceMode = 'postgresql-error-fallback-in-memory';
    }
  }
  dataSources.set(savedSource.id, savedSource);

  return {
    ok: true,
    mode: 'data-source-registry-safe-baseline',
    source: cloneSource(savedSource),
    realSync: false,
    persistenceMode
  };
};

export const listDataSources = () => {
  if (isPgRepositoryEnabled('data_sources')) {
    try {
      const sources = listDataSourcesFromPostgres();
      sources.forEach((source) => dataSources.set(source.id, source));
      return {
        ok: true,
        mode: 'data-source-registry-safe-baseline',
        count: sources.length,
        sources: sources.map(cloneSource),
        realSync: false,
        persistenceMode: 'postgresql-local-psql-repository'
      };
    } catch {
      // Safe fallback keeps the registry visible if the local psql adapter is unavailable.
    }
  }
  return {
    ok: true,
    mode: 'data-source-registry-safe-baseline',
    count: dataSources.size,
    sources: [...dataSources.values()].map(cloneSource),
    realSync: false,
    persistenceMode: isPgRepositoryEnabled('data_sources') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled'
  };
};

export const createDataSourceSyncRun = ({ dataSourceId, mapping = {}, actorEmail = null }) => {
  const source = getDataSource(dataSourceId);
  const errors = [];
  if (!source) errors.push('data_source_not_found');

  const requestedFields = Array.isArray(mapping.fields) ? mapping.fields.map((field) => String(field || '').trim()).filter(Boolean) : [];
  if (mapping.fields !== undefined && requestedFields.length === 0) errors.push('mapping_fields_required_when_mapping_provided');

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      mode: 'data-source-sync-dry-run-baseline',
      realSync: false,
      rowsPulled: 0,
      networkProbe: 'skipped'
    };
  }

  const blockers = [];
  if (!source.connection.secretStored) blockers.push('encrypted_connection_secret_required_for_future_live_sync');
  if (!source.syncEnabled) blockers.push('sync_disabled_until_mapping_and_import_gates_exist');

  const run = {
    id: `sync_${(++syncRunSequence).toString().padStart(6, '0')}`,
    dataSourceId: source.id,
    dataSourceName: source.name,
    status: 'validated_dry_run',
    mode: 'data-source-sync-dry-run-baseline',
    validation: {
      ok: true,
      requiredGates: [
        'admin_session',
        'registered_postgresql_source',
        'redacted_connection_metadata',
        'no_network_probe',
        'no_remote_rows_pulled',
        'sync_disabled'
      ],
      blockers
    },
    mapping: {
      status: requestedFields.length > 0 ? 'provided_for_validation_only' : 'not_configured',
      fields: requestedFields
    },
    rowsSeen: 0,
    rowsImported: 0,
    rowsPulled: 0,
    realSync: false,
    networkProbe: 'skipped',
    actorEmail,
    createdAt: nowIso(),
    finishedAt: nowIso()
  };
  syncRuns.set(run.id, run);

  return { ok: true, run: cloneSyncRun(run), realSync: false };
};

export const listDataSourceSyncRuns = () => ({
  ok: true,
  mode: 'data-source-sync-dry-run-baseline',
  count: syncRuns.size,
  runs: [...syncRuns.values()].map(cloneSyncRun),
  realSync: false
});

const validateImportScheduleMapping = (mapping = {}) => {
  const clean = {
    emailColumn: String(mapping.emailColumn || 'email').trim(),
    consentStatusColumn: String(mapping.consentStatusColumn || '').trim(),
    sourceColumn: String(mapping.sourceColumn || '').trim(),
    firstNameColumn: String(mapping.firstNameColumn || '').trim(),
    lastNameColumn: String(mapping.lastNameColumn || '').trim(),
    defaults: {
      consentStatus: String(mapping.defaults?.consentStatus || mapping.defaultConsentStatus || 'opt_in').trim(),
      source: String(mapping.defaults?.source || mapping.defaultSource || '').trim()
    }
  };
  const errors = [];
  if (!clean.emailColumn) errors.push('email_mapping_column_required');
  if (!clean.consentStatusColumn && !clean.defaults.consentStatus) errors.push('consent_status_column_or_default_required');
  if (!clean.sourceColumn && !clean.defaults.source) errors.push('source_column_or_default_required');
  if (clean.defaults.consentStatus && !['opt_in', 'double_opt_in'].includes(clean.defaults.consentStatus)) errors.push('explicit_consent_default_required');
  return { ok: errors.length === 0, errors, mapping: clean };
};

export const createDataSourceImportSchedule = ({ dataSourceId, sql, limit = 100, timeoutMs = 5000, intervalHours = 24, mapping = {}, approvalPhrase = '', enabled = false, actorEmail = null } = {}) => {
  const source = getDataSource(dataSourceId);
  const parsedInterval = Number(intervalHours);
  const errors = [];
  if (!source) errors.push('data_source_not_found');
  if (!Number.isInteger(parsedInterval) || parsedInterval < 1 || parsedInterval > 720) errors.push('valid_interval_hours_1_720_required');
  const queryPlan = validateDataSourceQuery({ dataSourceId, sql, limit, timeoutMs, explain: false, actorEmail });
  if (!queryPlan.ok) errors.push(...queryPlan.errors);
  const mappingPlan = validateImportScheduleMapping(mapping);
  if (!mappingPlan.ok) errors.push(...mappingPlan.errors);
  const wantsEnabled = Boolean(enabled);
  if (wantsEnabled && approvalPhrase !== requiredRemoteImportScheduleApprovalPhrase) errors.push('exact_remote_import_schedule_approval_phrase_required');
  if (errors.length > 0) {
    return {
      ok: false,
      mode: 'data-source-import-schedule-plan',
      errors,
      scheduleMutation: false,
      realSync: false,
      automaticPulls: false,
      source: sourcePublicView(source),
      queryPlan,
      mapping: mappingPlan.mapping || mapping
    };
  }

  const schedule = {
    id: `sync_schedule_${Date.now().toString(36)}_${(++scheduleSequence).toString().padStart(6, '0')}`,
    dataSourceId: source.id,
    dataSourceName: source.name,
    status: wantsEnabled ? 'approved_manual_schedule_plan' : 'planned_disabled',
    enabled: wantsEnabled,
    intervalHours: parsedInterval,
    nextRunPreviewAt: new Date(Date.now() + parsedInterval * 60 * 60 * 1000).toISOString(),
    query: {
      projectedSql: queryPlan.query.projectedSql,
      limit: queryPlan.query.limit,
      timeoutMs: queryPlan.query.timeoutMs,
      selectOnly: true
    },
    mapping: mappingPlan.mapping,
    validation: {
      ok: true,
      requiredGates: [
        'admin_session',
        'registered_postgresql_source',
        'select_only_query',
        'bounded_limit_timeout',
        'contact_field_mapping',
        'explicit_consent_and_source',
        'exact_schedule_approval_if_enabled',
        'manual_execution_only'
      ],
      blockers: source.connection.secretStored ? ['automatic_worker_not_enabled', 'remote_pull_requires_per_run_execution_gate'] : ['encrypted_connection_secret_required_for_future_live_sync', 'automatic_worker_not_enabled', 'remote_pull_requires_per_run_execution_gate']
    },
    safety: {
      noImmediateRemotePull: true,
      noAutomaticWorker: true,
      noContactImportMutation: true,
      noSecretOutput: true,
      redactedErrors: true,
      realDeliveryAllowed: false
    },
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  let savedSchedule = schedule;
  let persistenceMode = 'in-memory-until-postgresql-connection-enabled';
  if (isPgRepositoryEnabled('data_source_import_schedules')) {
    try {
      savedSchedule = saveImportScheduleToPostgres(schedule);
      persistenceMode = 'postgresql-local-psql-repository';
    } catch (error) {
      persistenceMode = 'postgresql-error-fallback-in-memory';
    }
  }
  importSchedules.set(savedSchedule.id, savedSchedule);
  return {
    ok: true,
    mode: 'data-source-import-schedule-plan',
    schedule: cloneImportSchedule(savedSchedule),
    scheduleMutation: true,
    realSync: false,
    automaticPulls: false,
    source: sourcePublicView(source),
    persistenceMode,
    realDeliveryAllowed: false
  };
};

export const listDataSourceImportSchedules = () => {
  if (isPgRepositoryEnabled('data_source_import_schedules')) {
    try {
      const schedules = listImportSchedulesFromPostgres();
      return {
        ok: true,
        mode: 'data-source-import-schedule-plan',
        count: schedules.length,
        schedules: schedules.map(cloneImportSchedule),
        realSync: false,
        automaticPulls: false,
        persistenceMode: 'postgresql-local-psql-repository',
        realDeliveryAllowed: false
      };
    } catch (error) {
      // Safe fallback keeps the operator schedule view available if the local psql adapter is unavailable.
    }
  }
  return {
    ok: true,
    mode: 'data-source-import-schedule-plan',
    count: importSchedules.size,
    schedules: [...importSchedules.values()].map(cloneImportSchedule),
    realSync: false,
    automaticPulls: false,
    persistenceMode: isPgRepositoryEnabled('data_source_import_schedules') ? 'postgresql-error-fallback-in-memory' : 'in-memory-until-postgresql-connection-enabled',
    realDeliveryAllowed: false
  };
};

export const getEncryptedSecretCountForTests = () => encryptedConnectionSecrets.size;
