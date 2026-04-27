import { listMigrations } from './migrations.js';

const MODULES = [
  { module: 'contacts', targetTable: 'contacts', runtimeMode: 'in-memory', priority: 1, blocker: 'wire_contact_repository_to_postgresql_driver' },
  { module: 'suppressions', targetTable: 'suppressions', runtimeMode: 'in-memory', priority: 2, blocker: 'wire_suppression_repository_to_postgresql_driver' },
  { module: 'templates', targetTable: 'templates', runtimeMode: 'in-memory', priority: 3, blocker: 'wire_template_repository_to_postgresql_driver' },
  { module: 'campaigns', targetTable: 'campaigns', runtimeMode: 'in-memory', priority: 4, blocker: 'wire_campaign_repository_to_postgresql_driver' },
  { module: 'send_queue', targetTable: 'send_jobs', runtimeMode: 'in-memory', priority: 5, blocker: 'wire_send_queue_repository_to_postgresql_driver' },
  { module: 'email_events', targetTable: 'email_events', runtimeMode: 'in-memory', priority: 6, blocker: 'wire_email_event_repository_to_postgresql_driver' },
  { module: 'warmup_policies', targetTable: 'warmup_policies', runtimeMode: 'in-memory', priority: 7, blocker: 'enable_policy_repository_after_pg_driver' },
  { module: 'reputation_policies', targetTable: 'reputation_policies', runtimeMode: 'in-memory', priority: 8, blocker: 'enable_policy_repository_after_pg_driver' },
  { module: 'audit_log', targetTable: 'audit_log', runtimeMode: 'in-memory', priority: 9, blocker: 'wire_audit_repository_to_postgresql_driver' },
  { module: 'users', targetTable: 'users', runtimeMode: 'bootstrap-env-plus-memory-session', priority: 10, blocker: 'wire_user_session_repository_to_postgresql_driver' }
];

export const repositoryReadiness = () => {
  const migrations = listMigrations();
  const hasPolicyFoundation = migrations.some((migration) => migration.id === '004_policy_repository_foundation');
  const modules = MODULES.map((entry) => ({
    ...entry,
    schemaReady: entry.targetTable ? true : false,
    liveRepositoryEnabled: false,
    nextAction: entry.blocker,
    safety: {
      noSecrets: true,
      noDataMutationFromReadiness: true,
      noRemoteProbe: true
    }
  }));

  return {
    ok: hasPolicyFoundation,
    mode: 'postgresql-repository-readiness',
    migration: hasPolicyFoundation ? '004_policy_repository_foundation' : null,
    schemaFoundationReady: hasPolicyFoundation,
    liveRepositoryEnabled: false,
    currentRuntimePersistence: 'in-memory-with-postgresql-schema-foundation',
    modules,
    summary: {
      totalModules: modules.length,
      schemaReadyModules: modules.filter((module) => module.schemaReady).length,
      liveRepositoryModules: modules.filter((module) => module.liveRepositoryEnabled).length,
      nextModule: modules[0].module
    },
    blockers: [
      'add_pg_driver_or_safe_psql_repository_adapter',
      'migrate_contacts_and_suppressions_first',
      'keep_test_fallback_in_memory',
      'avoid_printing_or_logging_database_url'
    ],
    realDeliveryAllowed: false
  };
};
