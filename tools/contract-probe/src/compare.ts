/**
 * Compares what two server versions answered, from the fixtures each probe run left
 * (`fixtures/<version>/`): fields an endpoint gained, lost or changed type, and feature flags
 * that appeared or went. Write probes' notes (`write.*`) are results, not shapes: left out.
 *
 *   npm run compare -- 0.11.3 0.12.5
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { shapeDiff, type Shape } from './shape';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  console.error('Usage: npm run compare -- <older version> <newer version>');
  process.exit(2);
}

const dirOf = (version: string) => path.join(import.meta.dirname, '..', 'fixtures', version);
for (const version of [from, to]) {
  if (!existsSync(dirOf(version))) {
    console.error(`No fixtures for ${version}: run the probe against that server first.`);
    process.exit(2);
  }
}

const files = (version: string) => readdirSync(dirOf(version)).filter((name) => name.endsWith('.json') && !name.startsWith('write.'));
const read = (version: string, name: string) => JSON.parse(readFileSync(path.join(dirOf(version), name), 'utf8')) as Record<string, unknown>;
const all = [...new Set([...files(from), ...files(to)])].sort();
let changes = 0;

for (const name of all) {
  const inFrom = files(from).includes(name);
  const inTo = files(to).includes(name);
  if (!inFrom || !inTo) {
    console.log(`${name}: only in ${inFrom ? from : to}`);
    continue;
  }
  const a = read(from, name);
  const b = read(to, name);
  const lines: string[] = [];
  if (a.shape !== undefined && b.shape !== undefined) lines.push(...shapeDiff(a.shape as Shape, b.shape as Shape));
  const flagsA = Object.keys((a.features ?? {}) as object);
  const flagsB = Object.keys((b.features ?? {}) as object);
  lines.push(...flagsB.filter((flag) => !flagsA.includes(flag)).map((flag) => `+ feature ${flag}`));
  lines.push(...flagsA.filter((flag) => !flagsB.includes(flag)).map((flag) => `- feature ${flag}`));
  if (!lines.length) continue;
  changes += lines.length;
  console.log(`${name}:`);
  for (const line of lines) console.log(`  ${line}`);
}

console.log(changes ? `\n${changes} differences between ${from} and ${to}.` : `\nNo differences in the shapes between ${from} and ${to}.`);
