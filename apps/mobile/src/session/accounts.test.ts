import { describe, expect, it } from 'vitest';
import { accountsIn, activeAccount, dropAccount, emptyIndex, markSignedOut, MAX_ACCOUNTS_PER_SPACE, parseAccountIndex, putAccount, serverHost, setActive, type AccountFields } from './accounts';

const owui = (userId: string, baseUrl = 'https://chat.example.com'): AccountFields => ({
  space: 'owui',
  baseUrl,
  userId,
  name: `Person ${userId}`,
  login: `${userId}@example.com`,
  expiresAt: null,
  signedIn: true,
});

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

describe('accounts', () => {
  it('adds accounts, makes the newest the one in use, and lists them in the order added', () => {
    let index = putAccount(emptyIndex(), owui('a'), newId, 1).index;
    index = putAccount(index, owui('b'), newId, 2).index;
    expect(accountsIn(index, 'owui').map((entry) => entry.userId)).toEqual(['a', 'b']);
    expect(activeAccount(index, 'owui')?.userId).toBe('b');
    expect(accountsIn(index, 'deeptutor')).toEqual([]);
  });

  it('signing in again updates the same account (same person, same server written differently)', () => {
    const first = putAccount(emptyIndex(), owui('a'), newId, 1);
    const again = putAccount(markSignedOut(first.index, first.id), { ...owui('a', 'https://CHAT.example.com/'), name: 'Renamed' }, newId, 5);
    expect(again.id).toBe(first.id);
    expect(again.index.accounts).toHaveLength(1);
    expect(again.index.accounts[0]).toMatchObject({ name: 'Renamed', signedIn: true, addedAt: 1 });
    // The same person on another server is another account.
    expect(putAccount(again.index, owui('a', 'https://other.example.com'), newId, 6).index.accounts).toHaveLength(2);
  });

  it('dropping the account in use hands over to the most recent one still signed in', () => {
    const a = putAccount(emptyIndex(), owui('a'), newId, 1);
    const b = putAccount(a.index, owui('b'), newId, 2);
    const c = putAccount(markSignedOut(b.index, b.id), owui('c'), newId, 3);
    const dropped = dropAccount(c.index, c.id);
    expect(dropped.wasActive).toBe(true);
    expect(dropped.next?.userId).toBe('a');
    expect(activeAccount(dropped.index, 'owui')?.userId).toBe('a');
    // Dropping one not in use changes nothing else.
    const other = dropAccount(dropped.index, b.id);
    expect(other).toMatchObject({ wasActive: false, next: null });
    expect(activeAccount(other.index, 'owui')?.userId).toBe('a');
    // The last one leaves no account in use.
    const last = dropAccount(other.index, a.id);
    expect(last.next).toBeNull();
    expect(activeAccount(last.index, 'owui')).toBeNull();
  });

  it('past the limit, the oldest signed-out account makes room', () => {
    let index = emptyIndex();
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACCOUNTS_PER_SPACE; i += 1) {
      const put = putAccount(index, owui(`u${i}`), newId, i);
      index = put.index;
      ids.push(put.id);
    }
    index = markSignedOut(index, ids[3] ?? '');
    index = putAccount(index, owui('new'), newId, 100).index;
    expect(accountsIn(index, 'owui')).toHaveLength(MAX_ACCOUNTS_PER_SPACE);
    expect(index.accounts.some((entry) => entry.id === ids[3])).toBe(false);
  });

  it('reads back what it saved and ignores what it can’t trust', () => {
    const put = putAccount(emptyIndex(), owui('a'), newId, 1);
    const saved = { ...setActive(put.index, 'deeptutor', put.id), migrated: ['owui', 'nonsense'] };
    const parsed = parseAccountIndex(JSON.stringify(saved));
    expect(parsed?.accounts).toHaveLength(1);
    expect(parsed?.active).toEqual({ owui: put.id });
    expect(parsed?.migrated).toEqual(['owui']);
    expect(parseAccountIndex(JSON.stringify({ ...saved, accounts: [{ id: 'x' }] }))?.accounts).toEqual([]);
    expect(parseAccountIndex('{not json')).toBeNull();
    expect(parseAccountIndex(null)).toBeNull();
    expect(parseAccountIndex(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it('names a server by its host', () => {
    expect(serverHost('https://chat.example.com/ai')).toBe('chat.example.com');
    expect(serverHost('http://user@10.0.0.2:3000')).toBe('10.0.0.2:3000');
  });
});
