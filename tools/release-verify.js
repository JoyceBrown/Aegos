import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const prepublish = process.argv.includes('--prepublish');
const commands = [
  ['cargo', ['fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']],
  ['cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml']],
  ['node', ['--check', 'src/app.js']],
  ['node', ['--check', 'src/routing-ui.js']],
  ['npm', ['run', 'smoke:interactions']],
  ['npm', ['run', 'smoke:perf']],
  ['npm', ['run', 'smoke:product']],
  ['npm', ['run', 'smoke:soak']],
  ['npm', ['run', 'audit:backend']],
  ['npm', ['run', 'audit:security']],
  ['npm', ['run', 'audit:control-plane']],
  ['npm', ['run', 'audit:core-domain']],
  ['npm', ['run', 'audit:home-product']],
  ['npm', ['run', 'audit:routing-product']],
  ['npm', ['run', 'audit:routing-assistant-maturity']],
  ['npm', ['run', 'audit:status-vocabulary']],
  ['npm', ['run', 'audit:subscription-product']],
  ['npm', ['run', 'audit:outbound-ip']],
  ['npm', ['run', 'audit:release']]
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe'
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status !== 0) {
    console.error(`Release verification failed: ${command} ${args.join(' ')}`);
    if (output) console.error(output);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${command} ${args.join(' ')}`);
}

for (const [command, args] of commands) run(command, args);

if (!prepublish) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0) {
      console.error(result.stderr || `git ${args.join(' ')} failed`);
      process.exit(result.status || 1);
    }
    return result.stdout.trim();
  };
  const expectedTag = `v${pkg.version}`;
  const head = git('rev-parse', 'HEAD');
  const remoteHead = git('rev-parse', 'origin/main');
  const tagHead = git('rev-list', '-n', '1', expectedTag);
  const dirty = git('status', '--porcelain');
  if (dirty || head !== remoteHead || head !== tagHead) {
    console.error(JSON.stringify({
      error: 'Git release state is not closed',
      dirty: Boolean(dirty),
      head,
      remoteHead,
      tag: expectedTag,
      tagHead
    }, null, 2));
    process.exit(2);
  }
  console.log(`PASS Git HEAD, origin/main, and ${expectedTag} are identical`);
}

console.log(JSON.stringify({ ok: true, version: pkg.version, prepublish }, null, 2));
