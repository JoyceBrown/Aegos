import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
const passed = [];
const check = (name, ok, detail) => (ok ? passed : failures).push({ name, ok, detail });

const fixtures = [
  'src-tauri/fixtures/subscriptions/clash-basic.yaml',
  'src-tauri/fixtures/subscriptions/mixed-uri.txt',
  'src-tauri/fixtures/subscriptions/unsupported-protocol.txt'
];
const main = read('src-tauri/src/main.rs');
const productSmoke = read('tools/product-journey-smoke.js');

check('offline acceptance fixtures contain no live subscription URLs', fixtures.every((file) => !/https?:\/\//i.test(read(file))), fixtures.join(', '));
check('offline acceptance covers a native config and modern URI subscription source', read(fixtures[0]).includes('proxies:') && /vless:|vless:\/\//i.test(read(fixtures[1])) && /tuic:|tuic:\/\//i.test(read(fixtures[1])), 'Clash + VLESS/TUIC fixture');
check('offline acceptance has an unsupported-protocol failure source', read(fixtures[2]).trim().length > 0, fixtures[2]);
check('Rust regression covers successful and unsupported sanitized sources', main.includes('sanitized_subscription_fixtures_parse_without_real_tokens') && main.includes('sanitized_subscription_fixture_reports_unsupported_protocols'), 'subscription parser tests');
check('real-user journey gate keeps subscription lifecycle and recovery paths explicit', productSmoke.includes('subscriptionLifecycle') && productSmoke.includes('diagnosticsRepairAndExport') && productSmoke.includes('nonBlockingBackgroundWork'), 'product journey contract');

const result = { ok: failures.length === 0, failed: failures, passed, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
