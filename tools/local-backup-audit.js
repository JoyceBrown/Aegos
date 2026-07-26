import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const passes = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function check(name, ok, detail = '') {
  (ok ? passes : failures).push({ name, ok: Boolean(ok), detail });
}

const packageJson = JSON.parse(read('package.json'));
const backupRuntime = read('src-tauri/src/backup_runtime.rs');
const mainRs = read('src-tauri/src/main.rs');
const appJs = read('src/app.js');
const interactionSmoke = read('tools/interaction-smoke.js');

check(
  'local backup audit is exposed as a package script',
  packageJson.scripts?.['audit:local-backup'] === 'node tools/local-backup-audit.js'
);
check(
  'backup format is Windows user scoped and encrypted with DPAPI',
  backupRuntime.includes('CryptProtectData')
    && backupRuntime.includes('CryptUnprotectData')
    && backupRuntime.includes('#[cfg(windows)]')
    && backupRuntime.includes('only available on Windows')
);
check(
  'backup contents have bounded sizes and an explicit allowlist',
  backupRuntime.includes('MAX_BACKUPS')
    && backupRuntime.includes('MAX_ENTRIES')
    && backupRuntime.includes('MAX_ENTRY_BYTES')
    && backupRuntime.includes('MAX_TOTAL_BYTES')
    && backupRuntime.includes('settings.json')
    && backupRuntime.includes('aegos-user-rules.json')
    && backupRuntime.includes('routing-user-rules.json')
    && backupRuntime.includes('profiles/')
    && backupRuntime.includes('is_allowed_entry_name')
);
check(
  'runtime data, deployment journals, diagnostics, and synchronization are outside the backup contract',
  !backupRuntime.includes('app_data.join("deployment-report")')
    && !backupRuntime.includes('app_data.join("system-takeover")')
    && !backupRuntime.includes('app_data.join("speed-health")')
    && !backupRuntime.includes('WebDAV')
    && !backupRuntime.includes('reqwest')
    && !backupRuntime.includes('http://')
    && !backupRuntime.includes('https://')
);
check(
  'backup integrity and failed writes have an explicit recovery path',
  backupRuntime.includes('BACKUP_MAGIC')
    && backupRuntime.includes('sha256_bytes')
    && backupRuntime.includes('validate_archive')
    && backupRuntime.includes('previous files were restored')
    && backupRuntime.includes('rollback also failed')
);
check(
  'restore is available only through the product coordinator while disconnected',
  mainRs.includes('fn restore_local_backup_detached')
    && mainRs.includes('lock_operation_queue(&operations, "restoreLocalBackup")')
    && mainRs.includes('if core.process.is_some()')
    && mainRs.includes('Disconnect Aegos before restoring a local backup.')
    && mainRs.includes('"restoreLocalBackup"')
    && mainRs.includes('local_backup_snapshot')
);
check(
  'settings UI uses background jobs, safe text nodes, and restore confirmation',
  appJs.includes("runBackgroundJob('createLocalBackup'")
    && appJs.includes("runBackgroundJob('restoreLocalBackup'")
    && appJs.includes('requestAppConfirm({')
    && appJs.includes("id: 'localBackupPanel'")
    && appJs.includes('textContent:')
    && !appJs.includes('localBackupList.innerHTML')
);
check(
  'interaction coverage creates and restores offline backups while blocking connected restore',
  interactionSmoke.includes("args.kind === 'createLocalBackup'")
    && interactionSmoke.includes("args.kind === 'restoreLocalBackup'")
    && interactionSmoke.includes('local backup creation did not use a background job')
    && interactionSmoke.includes('connected Aegos did not explicitly block local backup restore')
);

console.log(JSON.stringify({
  ok: failures.length === 0,
  failed: failures,
  passed: passes
}, null, 2));
process.exit(failures.length ? 2 : 0);
