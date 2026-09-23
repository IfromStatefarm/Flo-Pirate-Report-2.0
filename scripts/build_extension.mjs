import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { neutralEventConfig } from './release_policy.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--out-dir')) throw new Error('Usage: build_extension.mjs [--out-dir directory]');
const out = args.length ? path.resolve(args[1]) : path.join(root, 'output', 'release');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const target = path.join(out, `rights-reporter-${manifest.version}`);
const roots = ['manifest.json', 'background.js', 'clippy.js', 'content_autofill.js', 'content_form.js', 'content_scraper.js', 'intel_math.js', 'options.html', 'options.js', 'popup.html', 'popup.js', 'sidepanel.html', 'sidepanel.js', 'jingle.mp3', 'Piratemusic.mp3'];
const dirs = ['contracts', 'background', 'services', 'utils', 'options', 'popup', 'sidepanel', 'images', 'lib'];
const allowed = new Set(['.js', '.html', '.css', '.png', '.gif', '.svg', '.webp', '.jpg', '.mp3']);
const files = [...roots];
async function visit(directory) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink cannot enter the release: ${name}`);
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) await visit(name);
    else if (allowed.has(path.extname(name))) files.push(name);
  }
}
for (const dir of dirs) await visit(dir);
await fs.mkdir(out, { recursive: true });
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target);
for (const name of files) {
  const bytes = await fs.readFile(path.join(root, name));
  if (/\.(js|html|css|json)$/.test(name) && /postgres(?:ql)?:\/\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|(?:sk_live_|sk_test_)[A-Za-z0-9]{16,}/.test(bytes.toString())) throw new Error(`Potential secret in release file: ${name}`);
  await fs.mkdir(path.dirname(path.join(target, name)), { recursive: true });
  await fs.writeFile(path.join(target, name), bytes);
}
await fs.mkdir(path.join(target, 'config'));
const endpoints = JSON.parse(await fs.readFile(path.join(root, 'config/customer_bootstrap.json'), 'utf8'));
for (const [key, value] of Object.entries(endpoints)) if (key !== 'schemaVersion') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Only credential-free HTTPS endpoints can be released.');
}
await fs.writeFile(path.join(target, 'config/customer_bootstrap.json'), JSON.stringify(endpoints, null, 2));
const migration = JSON.parse(await fs.readFile(path.join(root, 'config/customer_migration.json'), 'utf8'));
migration.customerId = 'neutral'; migration.readMode = 'off';
await fs.writeFile(path.join(target, 'config/customer_migration.json'), JSON.stringify(migration, null, 2));
const events = neutralEventConfig(JSON.parse(await fs.readFile(path.join(root, 'events_config.json'), 'utf8')));
await fs.writeFile(path.join(target, 'events_config.json'), JSON.stringify(events, null, 2));
const zip = `${target}.zip`;
await fs.rm(zip, { force: true });
execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: target });
const archive = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
if (archive.some(name => /(^|\/)(\.env[^/]*|\.git|\.neon|server|api|migrations|tests|node_modules)(\/|$)/.test(name))) throw new Error('Forbidden path in extension archive.');
const digest = crypto.createHash('sha256').update(await fs.readFile(zip)).digest('hex');
await fs.writeFile(`${zip}.sha256`, `${digest}  ${path.basename(zip)}\n`);
console.log(`Built ${zip}\n${archive.filter(Boolean).length} archive entries; SHA-256 ${digest}`);
