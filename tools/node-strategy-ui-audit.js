import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const pkg = JSON.parse(read('package.json'));
const appJs = read('src/app.js');
const stylesCss = read('src/styles.css');
const releaseAudit = read('tools/release-audit.js');
const mainRs = read('src-tauri/src/main.rs');
const configPipelineRs = read('src-tauri/src/config_pipeline.rs');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
}

check(
  'node strategy UI audit is exposed as a package script',
  pkg.scripts?.['audit:node-strategy-ui'] === 'node tools/node-strategy-ui-audit.js',
  'npm run audit:node-strategy-ui'
);

check(
  'node table headers use three-state sort buttons without changing backend state',
  appJs.includes('let nodeSortState = { key: \'\', direction: 0 }') &&
    appJs.includes('function cycleNodeSort') &&
    appJs.includes('nodeSortButton(\'name\', \'节点名称\')') &&
    appJs.includes('nodeSortButton(\'delay\', \'延迟\')') &&
    appJs.includes('nodeSortButton(\'status\', \'状态\')') &&
    appJs.includes('scheduleRowsRender(latestGroup?.items || [], { force: true, target: \'nodes\', delay: 0 })'),
  'name/delay/status sort buttons are view-only'
);

check(
  'ordinary node views show all matches while extreme lists remain bounded',
  appJs.includes('nodeCandidateLimit') &&
    appJs.includes('nodeRows.length < nodeCandidateLimit') &&
    appJs.includes('const interactiveRender = largeList && (isForegroundHot() || isSpeedTestActive())') &&
    appJs.includes('const nodeVisibleLimit = largeList ? visibleNodeLimit : Math.max(nodeInitialRenderLimit, nodeRows.length)') &&
    appJs.includes('sortNodeRows(nodeRows).slice(0, nodeVisibleLimit)') &&
    appJs.includes('nodeInitialRenderLimit = 36') &&
    appJs.includes('nodeRenderLimit = 96') &&
    appJs.includes('interactiveNodeRenderLimit'),
  'ordinary subscriptions render every matching node; only extreme lists are capped'
);

check(
  'Proxies is first, GLOBAL is always hidden, and auto select follows Proxies',
  appJs.includes('function normalizeNodeGroups') &&
    appJs.includes('.filter((group) => !isGlobalGroup(group))') &&
    appJs.includes('visible.filter(isProxiesGroup).forEach(pushGroup)') &&
    appJs.includes('.filter(isAutoSelectGroup)') &&
    appJs.includes("const key = isAutoSelectGroup(group) ? 'auto-select'") &&
    appJs.includes('if (autoGroup && !visible.some(isAutoSelectGroup)) pushGroup(autoGroup)') &&
    appJs.includes('if ((Array.isArray(groups) ? groups : []).some(isAutoSelectGroup)) return null') &&
    !appJs.includes('visible.filter(isGlobalGroup).forEach(pushGroup)'),
  'strategy group strip order, GLOBAL hidden as an internal group, and synthetic auto select is not duplicated'
);

check(
  'strategy groups recursively resolve referenced groups while hiding strategy references',
  appJs.includes('function allRealProxyItemsFromGroups') &&
    appJs.includes('function allNodeViewGroup') &&
    appJs.includes('function resolveGroupRealItems') &&
    appJs.includes('function expandedNodeGroup') &&
    appJs.includes('itemGroupReferenceName(item, groupMap)') &&
    appJs.includes('expandedNodeGroup(isProxiesGroup(group) ? allNodeViewGroup(group, allItems) : group, source)') &&
    appJs.includes('backendGroupName: baseBackendGroup') &&
    appJs.includes('!isRealProxyNodeItem(item)') &&
    appJs.includes('function isBuiltinPolicyItem'),
  'referenced groups such as Disney -> Proxies show real selectable nodes'
);

check(
  'backend keeps Proxies as the user-facing all-node group without synthetic region groups',
  configPipelineRs.includes('fn ensure_proxies_group_contains_all_nodes') &&
    configPipelineRs.includes('ensure_proxies_group_contains_all_nodes(config, &proxy_names)') &&
    configPipelineRs.includes('pub(crate) fn is_internal_proxy_group_name') &&
    mainRs.includes('config_pipeline::normalize_runtime_proxy_groups_for_display') &&
    !mainRs.includes('fn ensure_proxies_group_contains_all_nodes') &&
    !mainRs.includes('for region in ["HK", "JP", "SG", "TW", "US"'),
  'Proxies contains all nodes; generated HK/JP/SG/TW/US groups stay removed'
);

check(
  'node page strategy groups have right-click management and drag sort mode',
  appJs.includes('function openNodeGroupContextMenu') &&
    appJs.includes('function nodeGroupContextSection') &&
    appJs.includes('function manageNodeGroupTargets') &&
    appJs.includes('function openNodeGroupMemberEditor') &&
    appJs.includes('function renderNodeMemberEditor') &&
    appJs.includes('function enterNodeGroupSortMode') &&
    appJs.includes('function finishNodeGroupSort') &&
    appJs.includes('function handleNodeGroupPointerDown') &&
    appJs.includes('nodeGroupOrderOverrides') &&
    appJs.includes("runBackgroundJob('applyRoutingGroupEdit'") &&
    appJs.includes("runBackgroundJob('applyRoutingRuleEdit'"),
  'node page can rename/delete/add groups, select nodes by region, edit target websites, and drag-sort cards'
);

check(
  'node strategy context menu is grouped and explains locked automatic groups',
  appJs.includes("nodeGroupContextSection('\\u7b56\\u7565\\u7ec4')") &&
    appJs.includes("nodeGroupContextSection('\\u5206\\u6d41')") &&
    appJs.includes("nodeGroupContextSection('\\u5e03\\u5c40')") &&
    appJs.includes('\\u81ea\\u52a8\\u9009\\u62e9\\u662f\\u6392\\u540d\\u89c6\\u56fe') &&
    stylesCss.includes('.node-group-context-section'),
  'right-click menu is grouped by strategy, routing, and layout instead of a flat command dump'
);

check(
  'target website editor has summary, priority explanation, and safe delete confirmation',
  appJs.includes("id: 'nodeTargetSummary'") &&
    appJs.includes('node-target-summary-card') &&
    appJs.includes('用户规则优先；越具体的网站/应用规则越先判断。') &&
    appJs.includes('async function deleteNodeTargetRuleFromEditor') &&
    appJs.includes("title: '删除目标网站'") &&
    appJs.includes('requestAppConfirm') &&
    stylesCss.includes('.node-target-summary') &&
    stylesCss.includes('.node-target-source.user'),
  'target-site editing explains counts and priority, and destructive deletes use the in-app dialog'
);

check(
  'target website editor prevents duplicate user rules and gives live examples',
  appJs.includes("id: 'nodeTargetInputHint'") &&
    appJs.includes('data-node-target-example') &&
    appJs.includes('function nodeTargetRuleConflict') &&
    appJs.includes('function updateNodeTargetInputHint') &&
    appJs.includes('已存在相同用户规则') &&
    appJs.includes('订阅内已有相同规则') &&
    appJs.includes("event.target?.id === 'nodeTargetConditionInput'") &&
    stylesCss.includes('.node-target-examples') &&
    stylesCss.includes('.node-target-examples small.is-bad'),
  'target-site editing validates before mutation and offers non-submitting example chips'
);

check(
  'strategy group strip uses fixed ten-card row, member picker, and horizontal wheel scrolling',
  stylesCss.includes('grid-auto-columns: minmax(132px, calc((100% - 90px) / 10))') &&
    stylesCss.includes('.node-group-context-menu') &&
    stylesCss.includes('.node-member-editor') &&
    stylesCss.includes('.node-member-regions') &&
    stylesCss.includes('.node-group-region') &&
    stylesCss.includes('.node-group-strip.sorting .node-group-card') &&
    appJs.includes('handleNodeGroupWheel') &&
    appJs.includes("strip.addEventListener('contextmenu', openNodeGroupContextMenu)") &&
    appJs.includes("strip.addEventListener('pointerdown', handleNodeGroupPointerDown)") &&
    appJs.includes("strip.addEventListener('pointermove', handleNodeGroupPointerMove)") &&
    !appJs.includes("strip.addEventListener('dragstart'"),
  'strategy cards stay compact, scroll horizontally, float while sorting, and edit members without text prompts'
);

check(
  'strategy group horizontal scrollbar has reserved space and cannot cover cards',
  stylesCss.includes('scrollbar-gutter: stable both-edges') &&
    stylesCss.includes('.node-group-strip::-webkit-scrollbar') &&
    stylesCss.includes('height: 8px') &&
    stylesCss.includes('.node-group-strip.sorting') &&
    stylesCss.includes('padding-bottom: 30px') &&
    stylesCss.includes('align-items: start'),
  'horizontal scrollbar is thin and the strip keeps extra bottom space while sorting'
);

check(
  'deleting a strategy group safely migrates rules to Proxies instead of leaving broken targets',
  mainRs.includes('and Proxies is not available as fallback') &&
    mainRs.includes('routing_rule_replace_target(raw, &validated_name, "Proxies")') &&
    mainRs.includes('groups.remove(index)'),
  'delete preserves valid routing targets through the transactional backend path'
);

check(
  'auto select uses measured quality signals and does not auto-connect',
  appJs.includes('function createAutoSelectGroup') &&
    appJs.includes('function autoSelectScore') &&
    appJs.includes('failurePenalty') &&
    appJs.includes('cooldownPenalty') &&
    appJs.includes('jitter * 0.4') &&
    appJs.includes('failureStreak * 160') &&
    !appJs.includes("runBackgroundJob('selectBestProxy'"),
  'auto select is a ranked view, not a connection action'
);

check(
  'virtual aggregate groups submit real backend group names when switching nodes',
  appJs.includes('backendGroupName') &&
    appJs.includes('function activeBackendProxyGroupName') &&
    appJs.includes('dataset: { node: name, backendGroup }') &&
    appJs.includes('selectNode(row.dataset.node, row.dataset.backendGroup || \'\')') &&
    appJs.includes("runBackgroundJob('changeProxy', { group: groupName, proxy: name }"),
  'virtual display groups cannot be submitted as missing backend groups'
);

check(
  'node sort and auto group affordances are visually explicit but lightweight',
  stylesCss.includes('.node-sort-button') &&
    stylesCss.includes('.sort-mark') &&
    stylesCss.includes('.node-group-card.auto:not(.active)') &&
    stylesCss.includes('background: transparent') &&
    stylesCss.includes('transition: background-color .16s ease'),
  'table headers and auto group feedback'
);

check(
  'release audit keeps node strategy UI rules visible',
  releaseAudit.includes('node strategy UI audit script exists'),
  'release gate includes node strategy UI lane'
);

const failed = results.filter((item) => !item.ok);
const result = {
  ok: failed.length === 0,
  failed,
  passed: results.filter((item) => item.ok),
  generatedAt: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
