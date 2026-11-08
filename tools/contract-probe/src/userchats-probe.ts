import { addUser, createChat, deleteChat, deleteUser, getConfig, getSharedChat, listAllUsers, listUserChats, signIn, usersFromCsv, type Capabilities, type OwuiClient } from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/**
 * Admin → Users' extras the app's way (admins, scratch servers only: it adds accounts): a
 * throwaway user writes a chat; as admin, it's in their list (found by words, and by title), it
 * opens through the shared-chat route by its id, and it's deleted; then a CSV with good and bad
 * rows adds the good ones. Every account made is deleted after.
 */
export async function probeUserChats({ client, anonymous, capabilities, baseUrl }: { client: OwuiClient; anonymous: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'users’ extras', ok: true, note: 'skipped: admins on the scratch servers only' });
    return { steps, fixture };
  }
  const stamp = Date.now().toString(36);
  const made: string[] = [];
  const access = record(record(await getConfig(client)).features).enable_admin_chat_access === true;
  fixture.adminChatAccess = access;
  try {
    await check('a user’s chats: listed (by words, by title), opened by id, deleted', async () => {
      if (!access) return 'skipped: this server doesn’t let admins see users’ chats';
      const email = `app-probe-chats-${stamp}@maviechat.invalid`;
      const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
      const user = await addUser(client, { name: 'APP PROBE chats', email, password, role: 'user' });
      made.push(user.id);
      const signedIn = await signIn(anonymous, email, password);
      if (signedIn.kind !== 'session') throw new Error(`the user’s sign-in answered ${signedIn.kind}`);
      const chat = await createChat(anonymous.withToken(signedIn.session.token), { title: `APP PROBE user chat ${stamp}`, models: [], history: { messages: {}, currentId: null }, messages: [], timestamp: Date.now() });
      const listed = await listUserChats(client, user.id);
      if (!listed.some((item) => item.id === chat.id)) throw new Error('not in their list');
      const found = await listUserChats(client, user.id, { query: stamp });
      if (!found.some((item) => item.id === chat.id)) throw new Error('not found by words');
      const byTitle = await listUserChats(client, user.id, { orderBy: 'title', direction: 'asc' });
      if (!byTitle.some((item) => item.id === chat.id)) throw new Error('not in the list by title');
      const opened = await getSharedChat(client, chat.id);
      if (opened.id !== chat.id) throw new Error('the shared-chat route didn’t open it by its id');
      await deleteChat(client, chat.id);
      if ((await listUserChats(client, user.id)).some((item) => item.id === chat.id)) throw new Error('still listed after Delete');
      return 'listed, found by words and by title, opened read-only by its id, deleted';
    });

    await check('CSV import: the good rows added, the bad ones named', async () => {
      const csv = ['Name,Email,Password,Role', `APP PROBE csv 1,app-probe-csv1-${stamp}@maviechat.invalid,pw-${stamp}-1,user`, 'Too,few,columns', `APP PROBE csv 2,app-probe-csv2-${stamp}@maviechat.invalid,pw-${stamp}-2,Pending`, ''].join('\r\n');
      const { users, problems } = usersFromCsv(csv);
      if (users.length !== 2 || problems.join() !== '3') throw new Error(`read ${users.length} rows and ${problems.length} problems`);
      for (const row of users) made.push((await addUser(client, { name: row.name, email: row.email, password: row.password, role: row.role })).id);
      const everyone = await listAllUsers(client);
      for (const row of users) {
        const there = everyone.find((user) => user.email === row.email);
        if (!there || there.role !== row.role) throw new Error(`row ${row.line} isn’t there as ${row.role}`);
      }
      return '2 added (a user, a pending one), row 3 named';
    });
  } finally {
    if (made.length) {
      await check('the throwaway accounts deleted', async () => {
        for (const id of made) await deleteUser(client, id);
        const left = (await listAllUsers(client)).filter((user) => made.includes(user.id));
        if (left.length) throw new Error(`${left.length} left`);
        return `${made.length} gone`;
      });
    }
  }
  return { steps, fixture };
}
