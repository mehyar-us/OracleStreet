import crypto from 'node:crypto';

const dataSources = new Map();
const encryptedConnectionSecrets = new Map();
let sequence = 0;
let secretSequence = 0;

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

export const resetDataSourcesForTests = () => {
  dataSources.clear();
  encryptedConnectionSecrets.clear();
  sequence = 0;
  secretSequence = 0;
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

export const getEncryptedSecretCountForTests = () => encryptedConnectionSecrets.size;
