const cleanPath = (value, fallback) => String(value || fallback || '').trim();
const cleanSchedule = (value) => String(value || 'daily').trim().toLowerCase();

export const backupReadiness = (env = process.env) => {
  const databaseUrlConfigured = Boolean(String(env.ORACLESTREET_DATABASE_URL || '').trim());
  const backupPath = cleanPath(env.ORACLESTREET_BACKUP_PATH, '/var/backups/oraclestreet');
  const schedule = cleanSchedule(env.ORACLESTREET_BACKUP_SCHEDULE || 'daily');
  const retentionDays = Number(env.ORACLESTREET_BACKUP_RETENTION_DAYS || 14);
  const errors = [];

  if (!backupPath.startsWith('/')) errors.push('absolute_backup_path_required');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) errors.push('valid_backup_retention_days_required');
  if (!['hourly', 'daily', 'weekly'].includes(schedule)) errors.push('valid_backup_schedule_required');

  return {
    ok: errors.length === 0,
    mode: 'backup-readiness-safe-gate',
    database: {
      urlConfigured: databaseUrlConfigured,
      commandTemplate: 'pg_dump --format=custom --no-owner --no-acl <redacted-database-url>',
      secretsRedacted: true,
      dumpProbe: 'skipped_readiness_only'
    },
    storage: {
      path: backupPath || null,
      pathProbe: 'skipped_readiness_only',
      encryptionRecommended: true,
      offsiteCopyRecommended: true
    },
    schedule: {
      frequency: schedule,
      systemdTimerCandidate: 'oraclestreet-backup.timer',
      retentionDays,
      restoreDrillRecommended: true
    },
    safety: {
      noDumpCreated: true,
      noFilesystemWrites: true,
      noSecretOutput: true,
      realDeliveryAllowed: false
    },
    recommendedCommands: [
      'install a root-owned backup script under /usr/local/sbin/oraclestreet-backup',
      'store backups outside the app repo under /var/backups/oraclestreet',
      'run pg_dump with credentials from /etc/oraclestreet only, never from git',
      'test restore into an isolated database before relying on backups'
    ],
    errors,
    realDeliveryAllowed: false
  };
};
