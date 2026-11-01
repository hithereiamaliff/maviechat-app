import { describe, expect, it } from 'vitest';
import support from './support.json';
import { compareVersions, isAtLeast, parseVersion, SUPPORT, supportStatus } from './version';

describe('parseVersion', () => {
  it('reads plain and v-prefixed versions', () => {
    expect(parseVersion('0.11.3')).toEqual([0, 11, 3]);
    expect(parseVersion('v0.12.5')).toEqual([0, 12, 5]);
    expect(parseVersion('0.12.5-dev')).toEqual([0, 12, 5]);
  });

  it('rejects anything else', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('0.12')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions([0, 11, 3], [0, 12, 0])).toBe(-1);
    expect(compareVersions([0, 12, 5], [0, 12, 4])).toBe(1);
    expect(compareVersions([1, 0, 0], [0, 99, 99])).toBe(1);
    expect(compareVersions([0, 11, 3], [0, 11, 3])).toBe(0);
  });

  it('isAtLeast handles unparsable input as false', () => {
    expect(isAtLeast('0.12.0', '0.11.3')).toBe(true);
    expect(isAtLeast('0.11.3', '0.11.3')).toBe(true);
    expect(isAtLeast('0.11.2', '0.11.3')).toBe(false);
    expect(isAtLeast(undefined, '0.11.3')).toBe(false);
  });
});

describe('supportStatus', () => {
  const range = { minSupported: '0.11.3', maxValidated: '0.12.5' };

  it('places a version relative to the validated range', () => {
    expect(supportStatus('0.11.3', range)).toBe('supported');
    expect(supportStatus('0.12.0', range)).toBe('supported');
    expect(supportStatus('0.11.2', range)).toBe('too-old');
    expect(supportStatus('0.12.6', range)).toBe('newer-than-validated');
    expect(supportStatus('nonsense', range)).toBe('unknown');
  });

  it('uses support.json by default', () => {
    expect(SUPPORT.minSupported).toBe(support.minSupported);
    expect(SUPPORT.maxValidated).toBe(support.maxValidated);
    expect(supportStatus(support.productionServer)).toBe('supported');
    expect(`v${support.productionServer}`).toBe(support.referenceTag);
  });
});
