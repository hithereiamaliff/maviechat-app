// Clean-room guard: fails when our source shares a copied passage with a pinned
// reference checkout (.ref/open-webui and .ref/deeptutor, made by `npm run ref:sync`).
// Clones inside a reference itself are ignored; only ours ↔ theirs pairs count.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const refRoot = path.join(root, '.ref');
const tagOf = (support) => JSON.parse(readFileSync(path.join(root, support), 'utf8')).referenceTag;

const references = [
  {
    name: 'Open WebUI',
    dir: path.join(refRoot, 'open-webui'),
    code: path.join(refRoot, 'open-webui', 'src'),
    tag: tagOf('packages/owui-protocol/src/support.json'),
    spec: 'docs/protocol.md',
  },
  {
    name: 'DeepTutor',
    dir: path.join(refRoot, 'deeptutor'),
    code: path.join(refRoot, 'deeptutor', 'web'),
    tag: tagOf('packages/deeptutor-protocol/src/support.json'),
    spec: 'docs/deeptutor.md',
  },
];

const missing = references.filter((reference) => !existsSync(reference.code));
if (missing.length > 0) {
  const message = `No ${missing.map((reference) => reference.name).join(' or ')} reference checkout: run \`npm run ref:sync\` first.`;
  if (process.env.CI) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.warn(`! ${message} Skipping the copy check.`);
  process.exit(0);
}

const ours = [path.join(root, 'apps/mobile/src')];
for (const group of ['packages', 'tools', 'services']) {
  for (const entry of readdirSync(path.join(root, group), { withFileTypes: true })) {
    const src = path.join(root, group, entry.name, 'src');
    if (entry.isDirectory() && existsSync(src)) ours.push(src);
  }
}

const output = path.join(root, '.jscpd-report');
rmSync(output, { recursive: true, force: true });
execFileSync(
  path.join(root, 'node_modules/.bin/jscpd'),
  [...ours, ...references.map((reference) => reference.code), '--min-tokens', '50', '--reporters', 'json', '--output', output, '--absolute', '--silent'],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
);

const report = JSON.parse(readFileSync(path.join(output, 'jscpd-report.json'), 'utf8'));
const referenceOf = (file) => references.find((reference) => file.startsWith(reference.dir + path.sep));
const shared = report.duplicates.filter((dup) => Boolean(referenceOf(dup.firstFile.name)) !== Boolean(referenceOf(dup.secondFile.name)));

if (shared.length > 0) {
  for (const dup of shared) {
    const [mine, theirs] = referenceOf(dup.firstFile.name) ? [dup.secondFile, dup.firstFile] : [dup.firstFile, dup.secondFile];
    const reference = referenceOf(theirs.name);
    console.error(
      `✗ ${path.relative(root, mine.name)}:${mine.start} matches ${path.relative(root, theirs.name)}:${theirs.start} (${dup.lines} lines, ${reference?.name})`,
    );
  }
  console.error(`✗ ${shared.length} passage(s) match a reference checkout. Rewrite them from the spec (docs/protocol.md, docs/deeptutor.md) instead of copying.`);
  process.exit(1);
}

console.log(`✓ no passages shared with ${references.map((reference) => `${reference.name} ${reference.tag}`).join(' or ')}`);
