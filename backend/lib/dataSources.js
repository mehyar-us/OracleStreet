const dataSources = new Map();
let sequence = 0;

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

export const resetDataSourcesForTests = () => {
  dataSources.clear();
  sequence = 0;
};

export const validateDataSource = ({ name, type = 'postgresql', connectionUrl }) => {
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
        connectionProbe: 'skipped_registry_validation_only'
      }
    }
  };
};

export const createDataSource = ({ name, type = 'postgresql', connectionUrl, actorEmail = null }) => {
  const validation = validateDataSource({ name, type, connectionUrl });
  if (!validation.ok) return { ok: false, errors: validation.errors, source: validation.source };

  const source = {
    id: `ds_${(++sequence).toString().padStart(6, '0')}`,
    name: validation.source.name,
    type: validation.source.type,
    status: 'registered_safe',
    connection: validation.source.connection,
    syncEnabled: false,
    actorEmail,
    createdAt: nowIso(),
    updatedAt: null
  };
  dataSources.set(source.id, source);

  return {
    ok: true,
    mode: 'data-source-registry-safe-baseline',
    source: { ...source, connection: { ...source.connection, parsed: { ...source.connection.parsed } } },
    realSync: false
  };
};

export const listDataSources = () => ({
  ok: true,
  mode: 'data-source-registry-safe-baseline',
  count: dataSources.size,
  sources: [...dataSources.values()].map((source) => ({
    ...source,
    connection: { ...source.connection, parsed: { ...source.connection.parsed } }
  })),
  realSync: false
});
