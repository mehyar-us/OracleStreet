const DEFAULT_APP_DB_URL = 'postgresql://oraclestreet_app@localhost:5432/oraclestreet';

const redactUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    if (url.username) url.username = url.username ? `${url.username}` : '';
    return url.toString();
  } catch {
    return null;
  }
};

export const getDatabaseConfig = (env = process.env) => {
  const rawUrl = env.ORACLESTREET_DATABASE_URL || env.DATABASE_URL || DEFAULT_APP_DB_URL;
  let parsed = null;
  try {
    const url = new URL(rawUrl);
    parsed = {
      protocol: url.protocol.replace(':', ''),
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, ''),
      usernameConfigured: Boolean(url.username),
      passwordConfigured: Boolean(url.password),
      sslMode: url.searchParams.get('sslmode') || 'not-specified'
    };
  } catch {
    parsed = null;
  }

  return {
    configured: Boolean(env.ORACLESTREET_DATABASE_URL || env.DATABASE_URL),
    source: env.ORACLESTREET_DATABASE_URL ? 'ORACLESTREET_DATABASE_URL' : env.DATABASE_URL ? 'DATABASE_URL' : 'default-local-placeholder',
    redactedUrl: redactUrl(rawUrl),
    parsed
  };
};

export const validateDatabaseConfig = (env = process.env) => {
  const config = getDatabaseConfig(env);
  const errors = [];
  if (!config.parsed) errors.push('valid_postgresql_url_required');
  else {
    if (!['postgresql', 'postgres'].includes(config.parsed.protocol)) errors.push('postgres_protocol_required');
    if (!config.parsed.host) errors.push('database_host_required');
    if (!Number.isInteger(config.parsed.port) || config.parsed.port < 1 || config.parsed.port > 65535) errors.push('valid_database_port_required');
    if (!config.parsed.database) errors.push('database_name_required');
    if (!config.parsed.usernameConfigured) errors.push('database_username_required');
  }

  return {
    ok: errors.length === 0,
    errors,
    config,
    connectionProbe: 'skipped_until_pg_driver_enabled',
    persistenceMode: 'in-memory-until-postgresql-connection-enabled'
  };
};
