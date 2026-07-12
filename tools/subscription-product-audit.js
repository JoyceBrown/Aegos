import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const subscriptionAudit = fs.readFileSync(path.join(root, 'tools', 'subscription-diagnostics-audit.js'), 'utf8');
const nodeFlowAudit = fs.readFileSync(path.join(root, 'tools', 'node-flow-audit.js'), 'utf8');
const interactionSmoke = fs.readFileSync(path.join(root, 'tools', 'interaction-smoke.js'), 'utf8');

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, detail });
}

function bodyBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

const refreshNodesBody = bodyBetween(appJs, 'async function refreshNodes', 'async function refreshProfileSurfaces');
const refreshProfileBody = bodyBetween(appJs, 'async function refreshProfileSurfaces', 'async function previewProfileNodes');
const resetBody = bodyBetween(appJs, 'function resetSpeedUiForProfileSwitch', 'async function pollSpeedTest');
const applyProfileBody = bodyBetween(appJs, 'function applyOptimisticProfile', 'function applyOptimisticNode');
const profileClickBody = bodyBetween(appJs, 'const profileSwitch =', 'const profileRename =');
const addProfileBody = bodyBetween(mainRs, 'fn add_profile_url_detached', 'fn update_profile_detached');
const updateProfileBody = bodyBetween(mainRs, 'fn update_profile_detached', 'fn update_all_profiles_detached');

check('version is 3.4.14', pkg.version === '3.4.14', pkg.version);

check(
  'subscription diagnostics remain actionable',
  mainRs.includes('fn subscription_diagnostic') &&
    mainRs.includes('unsupported-format') &&
    mainRs.includes('unsupported-protocol') &&
    mainRs.includes('runtime-preflight') &&
    subscriptionAudit.includes('subscription failure stages are classified') &&
    pkg.scripts?.['audit:subscription'] === 'node tools/subscription-diagnostics-audit.js',
  'download, parse, protocol, and runtime-preflight failures must explain the cause'
);

check(
  'import and update are transactional with rollback',
  addProfileBody.includes('previous_profile_id') &&
    addProfileBody.includes('Profile import applied but startup failed; rolled back') &&
    addProfileBody.includes('remove_file_confined') &&
    updateProfileBody.includes('previous_raw') &&
    updateProfileBody.includes('previous_profile') &&
    updateProfileBody.includes('Profile update applied but startup failed; restored previous subscription') &&
    updateProfileBody.includes('atomic_write_text_confined'),
  'bad subscriptions must not overwrite the last usable profile'
);

check(
  'subscription switch cancels stale volatile work',
  applyProfileBody.includes('resetSpeedUiForProfileSwitch()') &&
    resetBody.includes('profileStateSeq += 1') &&
    resetBody.includes('stopSpeedTestPolling()') &&
    resetBody.includes('latestSpeedStatus = null') &&
    resetBody.includes('outboundIpRequestSeq += 1') &&
    resetBody.includes("setOutboundIpText('-')") &&
    mainRs.includes('reset_speed_test_state("profile switched; previous speed test cancelled", true)'),
  'speed tests, node preview, and outbound IP queries are profile-scoped'
);

check(
  'stale node refresh cannot overwrite the new subscription',
  refreshNodesBody.includes('const requestProfileSeq = profileStateSeq') &&
    refreshNodesBody.includes('requestProfileSeq !== profileStateSeq') &&
    refreshNodesBody.includes('queuedNodeRefresh = { force, options }') &&
    refreshNodesBody.includes('void refreshNodes(queued.force, queued.options)'),
  'a force refresh requested during an in-flight old refresh is queued and replayed'
);

check(
  'profile surfaces refresh through one shared path',
  refreshProfileBody.includes('await refreshStatus(true)') &&
    refreshProfileBody.includes('await refreshNodes(true)') &&
    refreshProfileBody.includes('renderProfiles()') &&
    refreshProfileBody.includes('refreshOutboundIpAfterNodeChange()') &&
    (appJs.match(/refreshProfileSurfaces\(\{ refreshOutboundIp: true \}\)/g) || []).length >= 5,
  'import, update, switch, and remove use the same status/node/profile refresh path'
);

check(
  'subscription switching previews local nodes instead of blanking',
  appJs.includes('async function previewProfileNodes') &&
    appJs.includes("invoke('preview_profile_groups'") &&
    resetBody.includes('pendingRowItems = latestGroup?.items || []') &&
    !resetBody.includes('renderRows([])') &&
    nodeFlowAudit.includes('subscription switching does not blank the node lists') &&
    interactionSmoke.includes('quick subscription switch did not request local node preview'),
  'visible rows fade to preview rows while backend verifies the new profile'
);

check(
  'subscription menu is shared and top-level',
  indexHtml.includes('id="profileMenu"') &&
    indexHtml.includes('id="quickProfileBtn"') &&
    indexHtml.includes('id="nodeProfileBtn"') &&
    appJs.includes('profileMenuAnchor') &&
    appJs.includes('function toggleProfileMenu') &&
    interactionSmoke.includes('quick subscription menu was covered by another layer') &&
    interactionSmoke.includes('node page subscription button did not open the shared menu'),
  'home quick action and node page use one menu and one switch path'
);

check(
  'rename is optimistic and persisted through background job',
  appJs.includes('const profileRename =') &&
    appJs.includes('optimisticProfilePatch(profileRename, { name: trimmed })') &&
    appJs.includes('renameProfileJob(profileRename, trimmed)') &&
    mainRs.includes('rename_profile(profile_id, name)') &&
    mainRs.includes('"renameProfile"'),
  'ordinary users can rename subscriptions without editing files'
);

check(
  'subscription mutation UI has pending rows',
  appJs.includes('function applyOptimisticProfilePending') &&
    appJs.includes('function applyOptimisticProfilesPending') &&
    appJs.includes('function applyOptimisticProfileImport') &&
    appJs.includes('profilePendingText') &&
    appJs.includes('uiPendingLabel'),
  'long downloads/updates show local feedback instead of looking frozen'
);

check(
  'profile switch is background-job based',
  profileClickBody.includes('setActiveProfileJob(profileTarget)') &&
    profileClickBody.includes('pendingNotice') &&
    profileClickBody.includes('failureNotice') &&
    appJs.includes("runBackgroundJob('setActiveProfile'"),
  'switching subscriptions must not block navigation'
);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
