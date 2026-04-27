import { enabledRepositories, pgReady } from './localPg.js';
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
  { module: 'users', targetTable: 'users', runtimeMode: 'bootstrap-env-plus-memory-session', priority: 10, blocker: 'wire_user_repository_to_postgresql_driver' },
  { module: 'user_invite_password_workflow', targetTable: 'users', runtimeMode: 'manual-code-invite-reset', priority: 11, blocker: 'enable_user_invite_password_workflow_repository' },
  { module: 'admin_sessions', targetTable: 'admin_sessions', runtimeMode: 'signed-cookie-plus-memory-session-ledger', priority: 12, blocker: 'wire_session_repository_to_postgresql_driver' },
  { module: 'data_sources', targetTable: 'data_source_registry', runtimeMode: 'in-memory', priority: 13, blocker: 'wire_remote_source_registry_to_postgresql_driver' },
  { module: 'data_source_encrypted_secrets', targetTable: 'data_source_encrypted_secrets', runtimeMode: 'in-memory', priority: 14, blocker: 'wire_remote_source_secret_metadata_to_postgresql_driver' },
  { module: 'data_source_import_schedules', targetTable: 'data_source_import_schedules', runtimeMode: 'in-memory', priority: 15, blocker: 'wire_remote_import_schedule_repository_to_postgresql_driver' },
  { module: 'controlled_live_test_proof_audits', targetTable: 'controlled_live_test_proof_audits', runtimeMode: 'in-memory', priority: 16, blocker: 'wire_controlled_proof_audit_repository_to_postgresql_driver' }
];

export const repositoryReadiness = () => {
  const migrations = listMigrations();
  const hasPolicyFoundation = migrations.some((migration) => migration.id === '004_policy_repository_foundation');
  const enabled = enabledRepositories();
  const liveEnabled = (module) => enabled.has('all') || enabled.has(module);
  const modules = MODULES.map((entry) => ({
    ...entry,
    schemaReady: entry.targetTable ? true : false,
    liveRepositoryEnabled: liveEnabled(entry.module),
    nextAction: liveEnabled(entry.module) ? 'monitor_postgresql_repository_and_backfill_existing_memory_state' : entry.blocker,
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
    liveRepositoryEnabled: modules.some((module) => module.liveRepositoryEnabled),
    currentRuntimePersistence: modules.some((module) => module.liveRepositoryEnabled) ? 'partial-postgresql-runtime-repositories' : 'in-memory-with-postgresql-schema-foundation',
    modules,
    summary: {
      totalModules: modules.length,
      schemaReadyModules: modules.filter((module) => module.schemaReady).length,
      liveRepositoryModules: modules.filter((module) => module.liveRepositoryEnabled).length,
      psqlAdapterReady: pgReady(),
      nextModule: modules.find((module) => !module.liveRepositoryEnabled)?.module || 'all_core_runtime_repositories_enabled'
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
