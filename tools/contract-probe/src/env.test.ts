import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandHome, parseEnv } from './env';

describe('parseEnv', () => {
  it('reads KEY=VALUE lines with comments, quotes and export', () => {
    const text = [
      '# test account',
      'OWUI_URL=http://127.0.0.1:3003',
      'export OWUI_EMAIL="app-test@example.com"',
      "OWUI_PASSWORD='p@ss=word'",
      '',
      'not a line',
    ].join('\n');
    expect(parseEnv(text)).toEqual({
      OWUI_URL: 'http://127.0.0.1:3003',
      OWUI_EMAIL: 'app-test@example.com',
      OWUI_PASSWORD: 'p@ss=word',
    });
  });
});

describe('expandHome', () => {
  it('expands a leading tilde only', () => {
    expect(expandHome('~/.config/x')).toBe(path.join(homedir(), '.config/x'));
    expect(expandHome('/etc/x')).toBe('/etc/x');
  });
});
