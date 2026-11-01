import support from './support.json';

export type VersionTuple = readonly [major: number, minor: number, patch: number];

/** The server versions this build is tested against. Bump `maxValidated` only after the contract probe passes. */
export const SUPPORT = {
  minSupported: support.minSupported,
  maxValidated: support.maxValidated,
} as const;

export function parseVersion(input: string | null | undefined): VersionTuple | null {
  if (!input) return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(input.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a: VersionTuple, b: VersionTuple): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = a;
  const [bMajor, bMinor, bPatch] = b;
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

/** True when `version` is at least `target`; false when either can't be parsed. */
export function isAtLeast(version: string | null | undefined, target: string): boolean {
  const v = parseVersion(version);
  const t = parseVersion(target);
  return v !== null && t !== null && compareVersions(v, t) >= 0;
}

export type SupportStatus = 'supported' | 'too-old' | 'newer-than-validated' | 'unknown';

export function supportStatus(
  version: string | null | undefined,
  range: { minSupported: string; maxValidated: string } = SUPPORT,
): SupportStatus {
  const v = parseVersion(version);
  const min = parseVersion(range.minSupported);
  const max = parseVersion(range.maxValidated);
  if (!v || !min || !max) return 'unknown';
  if (compareVersions(v, min) < 0) return 'too-old';
  if (compareVersions(v, max) > 0) return 'newer-than-validated';
  return 'supported';
}
