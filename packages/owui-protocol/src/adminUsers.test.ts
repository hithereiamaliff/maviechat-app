import { describe, expect, it } from 'vitest';
import { listUserChats, usersFromCsv, USER_CHATS_PAGE } from './adminUsers';
import { OwuiClient, type FetchLike } from './http';

describe('a user’s chats', () => {
  it('asks for a page, words, order and direction, and reads ids, titles and times', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify([{ id: 'c1', title: 'Trip', updated_at: 1_731_045_600 }, { title: 'no id' }]), { status: 200 });
    };
    const chats = await listUserChats(new OwuiClient({ baseUrl: 'https://chat.test', token: 't', fetch }), 'u 1', { page: 2, query: 'trip', orderBy: 'title', direction: 'asc' });
    expect(chats).toEqual([{ id: 'c1', title: 'Trip', updatedAt: 1_731_045_600_000 }]);
    expect(urls[0]).toBe('https://chat.test/api/v1/chats/list/user/u%201?page=2&query=trip&order_by=title&direction=asc');
    expect(USER_CHATS_PAGE).toBe(60);
  });
});

describe('users from a CSV file', () => {
  it('reads rows after the header as the web does, naming the ones of another shape or role', () => {
    const csv = 'Name,Email,Password,Role\r\nAda,ada@example.com,secret,User\r\n\r\nBob,bob@example.com,pw\nCyd, cyd@example.com ,pw,owner\nDee,dee@example.com,pw,ADMIN\n';
    const { users, problems } = usersFromCsv(csv);
    expect(users).toEqual([
      { line: 2, name: 'Ada', email: 'ada@example.com', password: 'secret', role: 'user' },
      { line: 6, name: 'Dee', email: 'dee@example.com', password: 'pw', role: 'admin' },
    ]);
    expect(problems).toEqual([4, 5]);
    expect(usersFromCsv('Name,Email,Password,Role')).toEqual({ users: [], problems: [] });
  });
});
