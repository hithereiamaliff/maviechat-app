// Fails when anything the app ships depends on copyleft or Open WebUI-licensed code.
// Only production dependencies of the app and the protocol package are checked;
// dev tools are not shipped. Packages without a declared licence are listed as warnings.
// With --write it also saves the notices the About screen shows, with each licence's text
// (apps/mobile/src/generated/licenses.json and license-texts.json).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acceptable, FORBIDDEN } from './lib/spdx.mjs';

const root = path.resolve(import.meta.dirname, '..');

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
const dual = [];
const shipped = [];
for (const [key, info] of packages) {
  if (key.startsWith('@maviechat/')) continue;
  const licence = licenceOf(info);
  shipped.push({ name: key.slice(0, key.lastIndexOf('@')), version: info.version, license: licence ?? 'unknown', dir: info.path });
  if (!licence) unknown.push(key);
  else if (!acceptable(licence)) forbidden.push(`${key} (${licence})`);
  else if (FORBIDDEN.test(licence)) dual.push(`${key} (${licence})`);
}

for (const entry of dual) console.log(`· dual-licensed, used under its permissive option: ${entry}`);
for (const key of unknown) console.warn(`! no licence declared: ${key}`);
if (forbidden.length > 0) {
  for (const entry of forbidden) console.error(`✗ forbidden licence: ${entry}`);
  process.exit(1);
}
console.log(`✓ ${packages.size} production packages, no copyleft or Open WebUI-licensed code`);

if (process.argv.includes('--write')) writeNotices();

/**
 * The notices the About screen shows: every shipped package with its licence text (MIT, BSD and
 * Apache all ask for it to travel with the app), Heroicons (a dev dependency whose artwork the
 * app draws), and the native libraries compiled into the iOS app (scripts/native-licenses).
 * Texts are kept once each in license-texts.json; entries point at them.
 */
function writeNotices() {
  const LICENCE_FILE = /^(licen[sc]e|copying|notice)([-._].*)?$/i;
  const texts = [];
  const indexOf = new Map();
  const keep = (text) => {
    const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    if (!indexOf.has(clean)) {
      indexOf.set(clean, texts.length);
      texts.push(clean);
    }
    return indexOf.get(clean);
  };
  const filesIn = (dir) =>
    dir && existsSync(dir)
      ? readdirSync(dir)
          .filter((file) => LICENCE_FILE.test(file) && statSync(path.join(dir, file)).isFile())
          .sort((a, b) => Number(/^notice/i.test(a)) - Number(/^notice/i.test(b)) || a.localeCompare(b))
          .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      : [];
  const manifestOf = (dir) => (dir && existsSync(path.join(dir, 'package.json')) ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) : {});
  const repoOf = (pkg) => {
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const match = url?.match(/github\.com[/:]([^/]+\/[^/.#]+)/i) ?? url?.match(/^([\w.-]+\/[\w.-]+)$/);
    return match ? match[1].toLowerCase() : null;
  };
  const holderOf = (pkg, name) => {
    const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
    return author ? author.replace(/<[^>]*>|\([^)]*\)/g, '').trim() : `the ${name} authors`;
  };

  shipped.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const own = new Map(shipped.map((item) => [`${item.name}@${item.version}`, filesIn(item.dir)]));
  // A package without its own licence file: the file of another package from the same repository
  // (Expo's and React Native's monorepos), else the licence's standard text with the package's author.
  const byRepo = new Map();
  for (const item of shipped) {
    const repo = repoOf(manifestOf(item.dir));
    const files = own.get(`${item.name}@${item.version}`);
    if (repo && files.length && !byRepo.has(repo)) byRepo.set(repo, files);
  }
  const textOf = (name) => own.get([...own.keys()].find((key) => key.startsWith(`${name}@`)))?.[0];
  const apache = shipped.map((item) => own.get(`${item.name}@${item.version}`)[0]).find((text) => /^\s*Apache License\s+Version 2\.0/.test(text ?? '') && /END OF TERMS AND CONDITIONS/.test(text));
  const templates = {
    MIT: (holder) => textOf('react-native')?.replace(/^Copyright .*$/m, `Copyright (c) ${holder}`),
    ISC: (holder) => textOf('semver')?.replace(/^Copyright .*$/m, `Copyright (c) ${holder}`),
    'Apache-2.0': () => apache,
  };

  const notices = [];
  const missing = [];
  for (const item of shipped) {
    let files = own.get(`${item.name}@${item.version}`);
    let standard = false;
    if (!files.length) {
      const pkg = manifestOf(item.dir);
      files = byRepo.get(repoOf(pkg)) ?? [];
      if (!files.length && templates[item.license]) {
        const text = templates[item.license](holderOf(pkg, item.name));
        if (text) {
          files = [text];
          standard = true;
        }
      }
    }
    if (!files.length) missing.push(`${item.name}@${item.version}`);
    notices.push({ name: item.name, version: item.version, license: item.license, ...(standard ? { standard: true } : {}), texts: files.map(keep) });
  }

  const heroicons = path.join(root, 'node_modules/heroicons');
  notices.push({ name: 'heroicons', version: manifestOf(heroicons).version ?? 'unknown', license: 'MIT', via: 'the app’s icons', texts: filesIn(heroicons).map(keep) });
  if (!filesIn(heroicons).length) missing.push('heroicons');

  const nativeDir = path.join(root, 'scripts/native-licenses');
  const native = JSON.parse(readFileSync(path.join(nativeDir, 'index.json'), 'utf8')).libraries;
  for (const library of native) {
    notices.push({ name: library.name, version: library.version, license: library.license, via: library.via, texts: library.files.map((file) => keep(readFileSync(path.join(nativeDir, file), 'utf8'))) });
  }

  if (missing.length) {
    for (const key of missing) console.error(`✗ no licence text found: ${key}`);
    process.exit(1);
  }
  notices.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.version.localeCompare(b.version));
  const target = path.join(root, 'apps/mobile/src/generated/licenses.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(notices, null, 2)}\n`);
  writeFileSync(path.join(path.dirname(target), 'license-texts.json'), `${JSON.stringify(texts, null, 2)}\n`);
  const size = texts.reduce((sum, text) => sum + text.length, 0);
  console.log(`✓ ${notices.length} notices (${shipped.length} packages, Heroicons, ${native.length} native libraries), ${texts.length} texts (${Math.round(size / 1024)} KB) → ${path.relative(root, path.dirname(target))}`);
}
