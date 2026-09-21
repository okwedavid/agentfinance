// Production database baseline bootstrap (non-destructive).
//
// Why this exists: the production AgentFinance PostgreSQL database was created
// by `prisma db push` (no `_prisma_migrations` history table). On the next
// deploy, `prisma migrate deploy` fails with P3005 "The database schema is not
// empty" because Prisma will not adopt an un-baselined non-empty database.
//
// This script only RECORDS already-applied migrations with `migrate resolve
// --applied`. It never runs DDL, never touches table data, and never runs
// `db push`/`migrate reset`/drops. After it runs, `prisma migrate deploy`
// applies only the migrations the schema still lacks.
//
// Pass/fail decision per database state:
//   - `_prisma_migrations` already exists -> nothing to do, exit 0.
//   - No application tables at all        -> fresh database, nothing to do, exit 0.
//   - Application tables but NO history   -> the production-shape database:
//       * always record the phase0 baseline migration (it reproduces the
//         pre-migration schema, i.e. what `db push` created), then
//       * additionally record phase1_1 / phase2 ONLY if their schema signals
//         (email columns / Task.retryCount) are already present, so `deploy`
//         never re-runs DDL against existing columns.
// Any failure here aborts the start chain loudly (exit 1) rather than booting
// against a database Prisma cannot manage.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const PRISMA_CLI = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));

const MIGRATIONS_BY_ORDER = [
  '20260915000000_phase0_baseline',
  '20260920000000_phase1_1_email_verification',
  '20260925000000_phase2_security',
];

const APP_TABLES = ['User', 'Task', 'Agent'];

function log(prefix, msg) {
  process.stdout.write(`[baseline] ${prefix}: ${msg}\n`);
}

async function tableExists(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."${table}"') IS NOT NULL AS ok`
  );
  return Boolean(rows[0] && rows[0].ok);
}

async function columnExists(prisma, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.columns ` +
      `WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    table,
    column
  );
  return (rows[0] && rows[0].n) > 0;
}

function resolveApplied(migrationName) {
  log('resolve', `recording already-applied migration ${migrationName}`);
  execFileSync(
    process.execPath,
    [PRISMA_CLI, 'migrate', 'resolve', '--applied', migrationName, '--schema', SCHEMA_PATH],
    { cwd: BACKEND_ROOT, stdio: 'inherit', env: process.env }
  );
}

async function main() {
  const prisma = new PrismaClient({ log: ['error'] });
  try {
    if (await tableExists(prisma, '_prisma_migrations')) {
      log('skip', 'migration history table already exists; nothing to baseline.');
      await prisma.$disconnect();
      return;
    }

    let hasAppTables = false;
    for (const t of APP_TABLES) {
      if (await tableExists(prisma, t)) {
        hasAppTables = true;
        break;
      }
    }
    if (!hasAppTables) {
      log('skip', 'no application tables found (fresh database); nothing to baseline.');
      await prisma.$disconnect();
      return;
    }

    log('baseline', 'application tables present without migration history (production-shape database).');
    const toResolve = [MIGRATIONS_BY_ORDER[0]]; // phase0 baseline always

    if (
      (await columnExists(prisma, 'User', 'emailVerified')) ||
      (await columnExists(prisma, 'User', 'emailVerificationToken'))
    ) {
      toResolve.push(MIGRATIONS_BY_ORDER[1]);
      log('probe', 'User email-verification columns present -> phase1_1 considered applied.');
    }
    if (await columnExists(prisma, 'Task', 'retryCount')) {
      toResolve.push(MIGRATIONS_BY_ORDER[2]);
      log('probe', 'Task.retryCount present -> phase2 considered applied.');
    }

    await prisma.$disconnect();

    for (const name of toResolve) resolveApplied(name);

    log('done', `recorded ${toResolve.length} migration(s) as applied; deploying the rest.`);
  } catch (err) {
    process.stderr.write(`[baseline] FATAL: ${err && err.message ? err.message : err}\n`);
    try { await prisma.$disconnect(); } catch {}
    process.exit(1);
  }
}

main();