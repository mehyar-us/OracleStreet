import crypto from 'node:crypto';

const dataSources = new Map();
const encryptedConnectionSecrets = new Map();
const syncRuns = new Map();
let sequence = 0;
let secretSequence = 0;
let syncRunSequence = 0;

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

  const id = `ds_secret_${(++secretSequence).toString().padStart(6, '0')}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(readiness.algorithm, deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  encryptedConnectionSecrets.set(id, {
    id,
    algorithm: readiness.algorithm,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: authTag.toString('base64url'),
    createdAt: nowIso()
  });
  return {
    ok: true,
    ref: id,
    metadata: {
      ref: id,
      algorithm: readiness.algorithm,
      encryptedAt: encryptedConnectionSecrets.get(id).createdAt,
      ciphertextStored: true,
      plaintextReturned: false
    }
  };
};


const destructiveSqlPattern = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|analyze)\b/i;
const hasSelectPrefix = (sql) => /^\s*(select|with)\b/i.test(sql);
const hasLimit = (sql) => /\blimit\s+\d+\b/i.test(sql);

export const validateDataSourceQuery = ({ dataSourceId, sql, limit = 100, timeoutMs = 5000, explain = true, actorEmail = null }) => {
  const source = dataSources.get(String(dataSourceId || '').trim());
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
      source: source ? { id: source.id, name: source.name, connection: { parsed: { ...source.connection.parsed }, secretStored: source.connection.secretStored } } : null
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


export const planDataSourceSchemaDiscovery = ({ dataSourceId, schemas = ['public'], tableLimit = 100, columnLimit = 500, timeoutMs = 5000, actorEmail = null }) => {
  const source = dataSources.get(String(dataSourceId || '').trim());
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
      source: source ? { id: source.id, name: source.name, connection: { parsed: { ...source.connection.parsed }, secretStored: source.connection.secretStored } } : null
    };
  }

  const quotedSchemas = requestedSchemas.map((schema) => `'${schema.replaceAll("'", "''")}'`).join(', ');
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

export const resetDataSourcesForTests = () => {
  dataSources.clear();
  encryptedConnectionSecrets.clear();
  syncRuns.clear();
  sequence = 0;
  secretSequence = 0;
  syncRunSequence = 0;
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
    id: `ds_${(++sequence).toString().padStart(6, '0')}`,
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
  dataSources.set(source.id, source);

  return {
    ok: true,
    mode: 'data-source-registry-safe-baseline',
    source: cloneSource(source),
    realSync: false
  };
};

export const listDataSources = () => ({
  ok: true,
  mode: 'data-source-registry-safe-baseline',
  count: dataSources.size,
  sources: [...dataSources.values()].map(cloneSource),
  realSync: false
});

export const createDataSourceSyncRun = ({ dataSourceId, mapping = {}, actorEmail = null }) => {
  const source = dataSources.get(String(dataSourceId || '').trim());
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

export const getEncryptedSecretCountForTests = () => encryptedConnectionSecrets.size;
