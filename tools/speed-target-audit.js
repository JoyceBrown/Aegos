import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainRs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const speedAudit = fs.readFileSync(path.join(root, 'tools', 'speed-closure-audit.js'), 'utf8');
const contractPath = 'speed-target-contract.md';
const contract = fs.existsSync(path.join(root, contractPath)) ? fs.readFileSync(path.join(root, contractPath), 'utf8') : '';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const pass = [];
const fail = [];

function check(name, ok, detail = '') {
  (ok ? pass : fail).push({ name, ok, detail });
}

function semverAtLeast(version, baseline) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const current = parse(version);
  const min = parse(baseline);
  for (let index = 0; index < Math.max(current.length, min.length); index += 1) {
    const left = current[index] || 0;
    const right = min[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

const reasonKeys = [
  'dns-fake-ip',
  'protection-blocked',
  'node-not-found',
  'node-connect',
  'controller-delay-error',
  'probe-failed',
  'timeout',
  'dns',
  'tls',
  'auth',
  'controller-unavailable',
  'unsupported-protocol',
  'config',
  'network',
  'unknown',
];

check('speed target contract exists', Boolean(contract), contractPath);
check(
  'contract records primary and full target families',
  ['https://www.gstatic.com/generate_204', 'http://www.gstatic.com/generate_204', 'http://cp.cloudflare.com/generate_204', 'https://cp.cloudflare.com/generate_204'].every((text) => contract.includes(text)),
  'generate_204 target family'
);
check(
  'backend primary batch target is fixed',
  mainRs.includes('const FLCLASH_STYLE_TEST_URL: &str = "https://www.gstatic.com/generate_204"') &&
    mainRs.includes('url: FLCLASH_STYLE_TEST_URL') &&
    mainRs.includes('DelayProbeDepth::Fast'),
  'primary batch target'
);
check(
  'backend full diagnostic target family is available',
  ['"http://www.gstatic.com/generate_204"', '"https://www.gstatic.com/generate_204"', '"http://cp.cloudflare.com/generate_204"', '"https://cp.cloudflare.com/generate_204"'].every((text) => mainRs.includes(text)) &&
    mainRs.includes('DelayProbeDepth::Full'),
  'full diagnostic targets'
);
check(
  'backend failure classifier covers required keys',
  reasonKeys.every((key) => mainRs.includes(key) || key === 'unknown'),
  'backend reason keys'
);
check(
  'frontend label map covers required user-facing buckets',
  ['DNS 污染', '保护拦截', '节点缺失', '节点不通', '核心测速失败', '探测失败', '超时', 'DNS 失败', 'TLS 失败', '认证失败', '核心未响应', '协议不支持', '配置错误', '连接失败', '测速失败'].every((text) => appJs.includes(text)),
  'frontend reason labels'
);
check(
  'tested failed nodes keep visible reason state',
  appJs.includes('function nodeSpeedNoteInfo') &&
    appJs.includes('hasFailed') &&
    appJs.includes('speedFailureReasonLabel(failureReason)') &&
    appJs.includes("className: 'node-note note-bad'") &&
    speedAudit.includes('failed speed tests keep a visible structured reason'),
  'visible failed reason'
);
check(
  'contract aligns entry points',
  ['Home one-click speed test', 'Node page batch speed test', 'Single node speed test', 'Current node refresh'].every((text) => contract.includes(text)),
  'entry point table'
);
check('package version keeps speed target gate after 2.9.55', semverAtLeast(pkg.version, '2.9.55'), pkg.version);

const result = { ok: fail.length === 0, failed: fail, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
