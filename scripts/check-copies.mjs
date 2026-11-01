// Clean-room guard: fails when our source shares a copied passage with the pinned
// Open WebUI reference checkout (.ref/open-webui, made by `npm run ref:sync`).
// Clones inside Open WebUI itself are ignored; only ours ↔ theirs pairs count.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const refRoot = path.join(root, '.ref');
const reference = path.join(refRoot, 'open-webui', 'src');
const tag = JSON.parse(readFileSync(path.join(root, 'packages/owui-protocol/src/support.json'), 'utf8')).referenceTag;

if (!existsSync(reference)) {
  const message = 'No Open WebUI reference checkout: run `npm run ref:sync` first.';
  if (process.env.CI) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.warn(`! ${message} Skipping the copy check.`);
  process.exit(0);
}

const ours = [path.join(root, 'apps/mobile/src')];
for (const group of ['packages', 'tools']) {
  for (const entry of readdirSync(path.join(root, group), { withFileTypes: true })) {
    const src = path.join(root, group, entry.name, 'src');
    if (entry.isDirectory() && existsSync(src)) ours.push(src);
  }
}

const output = path.join(root, '.jscpd-report');
rmSync(output, { recursive: true, force: true });
execFileSync(
  path.join(root, 'node_modules/.bin/jscpd'),
  [...ours, reference, '--min-tokens', '50', '--reporters', 'json', '--output', output, '--absolute', '--silent'],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] },
);

const report = JSON.parse(readFileSync(path.join(output, 'jscpd-report.json'), 'utf8'));
const inReference = (file) => file.startsWith(refRoot + path.sep);
const shared = report.duplicates.filter((dup) => inReference(dup.firstFile.name) !== inReference(dup.secondFile.name));

if (shared.length > 0) {
  for (const dup of shared) {
    const [mine, theirs] = inReference(dup.firstFile.name) ? [dup.secondFile, dup.firstFile] : [dup.firstFile, dup.secondFile];
    console.error(
      `✗ ${path.relative(root, mine.name)}:${mine.start} matches ${path.relative(root, theirs.name)}:${theirs.start} (${dup.lines} lines)`,
    );
  }
  console.error(`✗ ${shared.length} passage(s) match Open WebUI ${tag}. Rewrite them from the spec (docs/protocol.md) instead of copying.`);
  process.exit(1);
}

console.log(`✓ no passages shared with Open WebUI ${tag}`);
