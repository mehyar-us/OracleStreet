import { execFileSync } from 'node:child_process';

const parseDbUrl = (rawUrl = process.env.ORACLESTREET_DATABASE_URL || process.env.DATABASE_URL || '') => {
  try {
    const url = new URL(rawUrl);
    if (!['postgresql:', 'postgres:'].includes(url.protocol)) return null;
    return {
      host: url.hostname || '127.0.0.1',
      port: url.port || '5432',
      database: url.pathname.replace(/^\//, ''),
      username: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || '')
    };
  } catch {
    return null;
  }
};

export const enabledRepositories = (env = process.env) => new Set(String(env.ORACLESTREET_PG_REPOSITORIES || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean));

export const isPgRepositoryEnabled = (name, env = process.env) => {
  if (env.NODE_ENV === 'test') return false;
  const enabled = enabledRepositories(env);
  return enabled.has('all') || enabled.has(String(name || '').toLowerCase());
};

export const pgReady = (env = process.env) => Boolean(parseDbUrl(env.ORACLESTREET_DATABASE_URL || env.DATABASE_URL));

const escapeLiteral = (value) => {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

export const sqlLiteral = escapeLiteral;

export const runLocalPgRows = (sql, env = process.env) => {
  const config = parseDbUrl(env.ORACLESTREET_DATABASE_URL || env.DATABASE_URL);
  if (!config || !config.database || !config.username) throw new Error('postgresql_repository_config_missing');
  const output = execFileSync('psql', [
    '-h', config.host,
    '-p', config.port,
    '-U', config.username,
    '-d', config.database,
    '-q',
    '-At',
    '-F', '\t',
    '-v', 'ON_ERROR_STOP=1',
    '-c', sql
  ], {
    encoding: 'utf8',
    env: { ...env, PGPASSWORD: config.password },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000
  }).trim();
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((columns) => columns.length > 1 && !/^INSERT\s+\d+\s+\d+$/i.test(columns[0] || ''));
};
