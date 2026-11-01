// Fails when anything the app ships depends on copyleft or Open WebUI-licensed code.
// Only production dependencies of the app and the protocol package are checked;
// dev tools are not shipped. Packages without a declared licence are listed as warnings.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const FORBIDDEN = /\b(A?GPL|LGPL|SSPL|EUPL|OSL|CC-BY-NC)|open\s*webui/i;

let raw;
try {
  raw = execFileSync(
    'npm',
    ['ls', '--all', '--omit=dev', '--json', '--long', '--workspace', '@maviechat/mobile', '--workspace', '@maviechat/owui-protocol'],
    { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
} catch (error) {
  // npm ls exits non-zero for peer-dependency warnings but still prints the tree.
  raw = error.stdout;
}

const packages = new Map();
(function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    // Optional peers that aren't installed show up without a version; nothing of theirs ships.
    if (!child.version) continue;
    const key = `${name}@${child.version}`;
    if (packages.has(key)) continue;
    packages.set(key, child);
    walk(child);
  }
})(JSON.parse(raw));

function licenceOf(info) {
  const declared = info.license ?? info.licenses;
  if (declared) return describe(declared);
  const manifest = info.path && path.join(info.path, 'package.json');
  if (manifest && existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (pkg.license || pkg.licenses) return describe(pkg.license ?? pkg.licenses);
  }
  return null;
}

function describe(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(describe).join(' OR ');
  if (value && typeof value === 'object' && 'type' in value) return String(value.type);
  return JSON.stringify(value);
}

const forbidden = [];
const unknown = [];
for (const [key, info] of packages) {
  if (key.startsWith('@maviechat/')) continue;
  const licence = licenceOf(info);
  if (!licence) unknown.push(key);
  else if (FORBIDDEN.test(licence)) forbidden.push(`${key} (${licence})`);
}

for (const key of unknown) console.warn(`! no licence declared: ${key}`);
if (forbidden.length > 0) {
  for (const entry of forbidden) console.error(`✗ forbidden licence: ${entry}`);
  process.exit(1);
}
console.log(`✓ ${packages.size} production packages, no copyleft or Open WebUI-licensed code`);
