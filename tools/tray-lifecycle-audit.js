import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
const pass = [];
const failed = [];
const check = (name, ok, detail) => (ok ? pass : failed).push({ name, ok, detail });

check('tray feature is explicitly enabled', fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').includes('features = ["tray-icon"]'), 'Cargo feature');
check('tray runtime accepts one instance and restores it on a second launch', fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').includes('tauri-plugin-single-instance') && main.includes('tauri_plugin_single_instance::init') && main.includes('window.show()') && main.includes('window.set_focus()'), 'single-instance restore');
check('close request hides rather than terminates the runtime', main.includes('WindowEvent::CloseRequested') && main.includes('api.prevent_close()') && main.includes('window.hide()'), 'close to tray');
check('tray can restore and focus the main window', main.includes('TrayIconEvent::Click') && main.includes('window.show()') && main.includes('window.set_focus()'), 'restore window');
check('explicit tray exit preserves the existing shutdown transaction', main.includes('"quit"') && main.includes('shutdown_for_exit()') && main.includes('app.exit(0)'), 'quit and restore');
check('window close command remains an explicit application exit', main.includes('fn window_close') && main.includes('window.app_handle().exit(0)'), 'window close');

const result = { ok: failed.length === 0, failed, passed: pass, generatedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
