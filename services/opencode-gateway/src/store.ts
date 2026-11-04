import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A phone paired with this machine. Only a hash of its token is kept. */
export interface Device {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
}

interface Pairing {
  codeHash: string;
  expiresAt: number;
}

interface Saved {
  version: 1;
  devices: Device[];
  pairings: Pairing[];
}

/** A pairing code works once, within ten minutes. */
export const PAIRING_TTL_MS = 10 * 60_000;
const MAX_DEVICES = 20;
const MAX_PAIRINGS = 5;
/** Last-seen times are written at most this often. */
const SEEN_EVERY_MS = 10 * 60_000;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

/** The paired devices and pending pairing codes, in a private file (mode 600). */
export class DeviceStore {
  private saved: Saved = { version: 1, devices: [], pairings: [] };
  private readonly file: string | null;
  private readonly now: () => number;
  private readonly random: (bytes: number) => string;

  /** `file` null keeps everything in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now, random: (bytes: number) => string = randomToken) {
    this.file = file;
    this.now = now;
    this.random = random;
    if (!file) return;
    try {
      const loaded = JSON.parse(readFileSync(file, 'utf8')) as Saved;
      if (loaded?.version === 1 && Array.isArray(loaded.devices)) this.saved = { version: 1, devices: loaded.devices, pairings: Array.isArray(loaded.pairings) ? loaded.pairings : [] };
    } catch {
      // No file yet (or a damaged one): start empty; phones pair again.
    }
  }

  /** A one-time pairing code, good for ten minutes. Only its hash is kept. */
  createPairing(): { code: string; expiresAt: number } {
    const code = this.random(18);
    const expiresAt = this.now() + PAIRING_TTL_MS;
    const live = this.saved.pairings.filter((pairing) => pairing.expiresAt > this.now());
    this.saved.pairings = [...live, { codeHash: sha256(code), expiresAt }].slice(-MAX_PAIRINGS);
    this.persist();
    return { code, expiresAt };
  }

  /** Trades a pairing code (once) for a new device and its token, which is shown only now. */
  redeem(code: string, name: string): { device: Device; token: string } | null {
    const codeHash = sha256(code.trim());
    const match = this.saved.pairings.find((pairing) => pairing.expiresAt > this.now() && sameHash(pairing.codeHash, codeHash));
    // Expired codes go, and a used one can't be used again.
    this.saved.pairings = this.saved.pairings.filter((pairing) => pairing !== match && pairing.expiresAt > this.now());
    if (!match) {
      this.persist();
      return null;
    }
    const token = this.random(32);
    const device: Device = {
      id: this.random(9),
      name: name.trim().slice(0, 80) || 'iPhone',
      tokenHash: sha256(token),
      createdAt: this.now(),
      lastSeenAt: this.now(),
    };
    this.saved.devices = [device, ...this.saved.devices].slice(0, MAX_DEVICES);
    this.persist();
    return { device, token };
  }

  /** The device a token belongs to, if it's still paired. */
  authenticate(token: string): Device | null {
    if (!token) return null;
    const tokenHash = sha256(token);
    const device = this.saved.devices.find((item) => sameHash(item.tokenHash, tokenHash)) ?? null;
    if (device && this.now() - device.lastSeenAt > SEEN_EVERY_MS) {
      device.lastSeenAt = this.now();
      this.persist();
    }
    return device;
  }

  list(): Device[] {
    return [...this.saved.devices];
  }

  revoke(id: string): boolean {
    const before = this.saved.devices.length;
    this.saved.devices = this.saved.devices.filter((device) => device.id !== id);
    if (this.saved.devices.length === before) return false;
    this.persist();
    return true;
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.saved), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
