import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Which phones belong to which Open WebUI user. Push tokens and user ids only. */
interface Saved {
  version: 1;
  users: Record<string, { token: string; addedAt: number }[]>;
  /** When Open WebUI last posted an event here (shows the server-wide webhook is set up). */
  lastEventAt: number | null;
}

const MAX_PER_USER = 10;
/** One phone may hold several accounts on the server (the app's account switcher); this many at most. */
const MAX_USERS_PER_DEVICE = 10;

export class DeviceStore {
  private saved: Saved = { version: 1, users: {}, lastEventAt: null };
  private readonly file: string | null;
  private readonly now: () => number;

  /** `file` null keeps everything in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    if (!file) return;
    try {
      const loaded = JSON.parse(readFileSync(file, 'utf8')) as Saved;
      if (loaded?.version === 1 && typeof loaded.users === 'object') this.saved = { ...loaded, lastEventAt: loaded.lastEventAt ?? null };
    } catch {
      // No file yet (or a damaged one): start empty; phones register again on their next launch.
    }
  }

  get lastEventAt(): number | null {
    return this.saved.lastEventAt;
  }

  tokensFor(userId: string): string[] {
    return (this.saved.users[userId] ?? []).map((device) => device.token);
  }

  /**
   * A phone (its push token) now also belongs to this user: someone signed in to several accounts
   * hears from each. Past MAX_USERS_PER_DEVICE accounts, the one it was added to longest ago lets go.
   */
  add(userId: string, token: string): void {
    this.drop(userId, token);
    const holders = Object.entries(this.saved.users)
      .map(([id, devices]) => ({ id, addedAt: devices.find((device) => device.token === token)?.addedAt }))
      .filter((holder): holder is { id: string; addedAt: number } => holder.addedAt !== undefined)
      .sort((a, b) => a.addedAt - b.addedAt);
    for (const holder of holders.slice(0, Math.max(0, holders.length - (MAX_USERS_PER_DEVICE - 1)))) this.drop(holder.id, token);
    const devices = [{ token, addedAt: this.now() }, ...(this.saved.users[userId] ?? [])].slice(0, MAX_PER_USER);
    this.saved.users[userId] = devices;
    this.persist();
  }

  remove(userId: string, token: string): boolean {
    const removed = this.drop(userId, token);
    if (removed) this.persist();
    return removed;
  }

  /** A phone Apple says is gone (app deleted or notifications revoked). */
  forget(token: string): void {
    let removed = false;
    for (const id of Object.keys(this.saved.users)) removed = this.drop(id, token) || removed;
    if (removed) this.persist();
  }

  noteEvent(): void {
    const previous = this.saved.lastEventAt ?? 0;
    this.saved.lastEventAt = this.now();
    // Written at most once a minute: the time only shows the webhook works.
    if (this.saved.lastEventAt - previous > 60_000) this.persist();
  }

  private drop(userId: string, token: string): boolean {
    const devices = this.saved.users[userId];
    if (!devices) return false;
    const kept = devices.filter((device) => device.token !== token);
    if (kept.length === devices.length) return false;
    if (kept.length) this.saved.users[userId] = kept;
    else delete this.saved.users[userId];
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
