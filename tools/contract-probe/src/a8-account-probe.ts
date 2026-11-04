import {
  addMemory,
  clearMemories,
  createApiKey,
  deleteApiKey,
  deleteMemory,
  getApiKey,
  getSessionUser,
  getUserVariables,
  gravatarUrl,
  listMemories,
  OwuiHttpError,
  profileOf,
  updateMemory,
  updatePassword,
  updateProfile,
  updateUserVariables,
  type Capabilities,
  type OwuiClient,
  type Profile,
  type ServerConfig,
  type Variable,
} from '@maviechat/owui-protocol';
import { shapeOf } from './shape';
import type { WriteStep } from './write-probe';

interface AccountInput {
  client: OwuiClient;
  capabilities: Capabilities;
  config: ServerConfig | undefined;
}

/** A 1×1 PNG, as the picture the probe sets for a moment. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const statusOf = (error: unknown) => (error instanceof OwuiHttpError ? error.status : undefined);

/** Runs `run` and expects the server to refuse it with `status`. */
async function refused(run: () => Promise<unknown>, status: number, what: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (statusOf(error) === status) return;
    throw new Error(`${what}: expected ${status}, got ${statusOf(error) ?? (error instanceof Error ? error.message : String(error))}`);
  }
  throw new Error(`${what}: the server took it`);
}

/**
 * Milestone 2 slice A8.2 against a live server, in the test account: memories added, edited,
 * searched for and removed (cleared only when the account had none of its own); the profile and
 * your variables saved and put back exactly; a wrong current password refused (the password itself
 * is never changed); and an API key made and removed when the account had none. Memories are
 * embedded by the server (no chat model is called).
 */
export async function probeA8Account(input: AccountInput): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const { client, capabilities, config } = input;
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
      return true;
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };

  // ── Memories ──
  if (!capabilities.feature('memories', true)) {
    steps.push({ name: 'memories', ok: true, note: 'skipped: memories are off for this account' });
  } else {
    const made = new Set<string>();
    try {
      let before = 0;
      await check('memories: listed', async () => {
        const list = await listMemories(client);
        before = list.length;
        fixture.memories = { count: list.length, shape: list[0] ? shapeOf(list[0]) : null };
        return `${list.length} of the account's own`;
      });
      await check('memories: added with a path cleaned as the server does, edited, the path cleared', async () => {
        const added = await addMemory(client, { content: 'APP PROBE: likes green tea', type: 'user', path: '/app-probe//prefs/' });
        made.add(added.id);
        fixture.memory = { shape: shapeOf(added) };
        if (added.type !== 'user' || added.path !== 'app-probe/prefs') throw new Error(`added as ${added.type} at ${String(added.path)}`);
        const edited = await updateMemory(client, added.id, { content: 'APP PROBE: likes jasmine tea', type: 'context', path: '' });
        if (edited.type !== 'context' || edited.path !== null || edited.content !== 'APP PROBE: likes jasmine tea') throw new Error(`edited to ${edited.type} at ${String(edited.path)}`);
        const listed = await listMemories(client);
        if (listed[0]?.id !== added.id) throw new Error('the edited memory is not listed first');
        return 'type, path and words saved; listed first';
      });
      await check('memories: a bad path and empty words refused (400)', async () => {
        await refused(() => addMemory(client, { content: 'APP PROBE: bad path', type: 'user', path: 'a/../b' }), 400, 'a ".." path');
        await refused(() => addMemory(client, { content: '   ', type: 'user', path: '' }), 400, 'empty words');
        return 'both refused';
      });
      await check('memories: removed', async () => {
        for (const id of made) {
          if (!(await deleteMemory(client, id))) throw new Error('the server said no');
          made.delete(id);
        }
        const listed = await listMemories(client);
        if (listed.length !== before) throw new Error(`${listed.length} left, ${before} before`);
        return 'back to the account’s own';
      });
      if (before === 0) {
        await check('memories: cleared all', async () => {
          for (const content of ['APP PROBE: one', 'APP PROBE: two']) made.add((await addMemory(client, { content, type: 'context', path: '' })).id);
          if (!(await clearMemories(client))) throw new Error('the server said no');
          made.clear();
          const left = (await listMemories(client)).length;
          if (left) throw new Error(`${left} left`);
          return 'two added, then none';
        });
      } else {
        steps.push({ name: 'memories: cleared all', ok: true, note: 'skipped: the account has memories of its own' });
      }
    } finally {
      for (const id of made) await deleteMemory(client, id).catch(() => undefined);
    }
  }

  // ── Profile ──
  let original: Profile | null = null;
  let email = '';
  try {
    await check('profile: saved and read back', async () => {
      const user = await getSessionUser(client);
      original = profileOf(user);
      email = user.email;
      const probe: Profile = { name: `${original.name} (probe)`, profile_image_url: TINY_PNG, bio: 'APP PROBE bio', gender: 'probe words', date_of_birth: '1999-12-31' };
      await updateProfile(client, probe);
      const after = profileOf(await getSessionUser(client));
      if (JSON.stringify(after) !== JSON.stringify(probe)) throw new Error(`came back different: ${Object.keys(probe).filter((key) => after[key as keyof Profile] !== probe[key as keyof Profile]).join(', ')}`);
      return 'name, picture, bio, gender and birth date';
    });
    await check('profile: an SVG picture refused (422)', async () => {
      if (!original) throw new Error('no profile');
      await refused(() => updateProfile(client, { ...(original as Profile), profile_image_url: 'data:image/svg+xml;base64,PHN2Zy8+' }), 422, 'an SVG');
      return 'refused';
    });
    await check('profile: Gravatar address', async () => {
      const url = await gravatarUrl(client, email);
      if (!/^https:\/\/[^/]*gravatar\.com\//.test(url)) throw new Error('not a Gravatar address');
      return 'an https address';
    });
  } finally {
    if (original) {
      await check('profile put back as it was', async () => {
        const saved = original as Profile;
        await updateProfile(client, saved);
        if (JSON.stringify(profileOf(await getSessionUser(client))) !== JSON.stringify(saved)) throw new Error('the profile differs from before');
        return 'identical';
      });
    }
  }

  // ── Variables ──
  let variables: Variable[] | null = null;
  try {
    await check('variables: saved and read back; a bad name refused (400)', async () => {
      variables = await getUserVariables(client);
      fixture.variables = { count: variables.length };
      await updateUserVariables(client, [...variables, { key: 'app_probe', value: 'APP PROBE\r\nvalue' }]);
      const after = await getUserVariables(client);
      if (after.find((item) => item.key === 'app_probe')?.value !== 'APP PROBE\nvalue') throw new Error('the probe variable did not come back');
      await refused(() => updateUserVariables(client, [{ key: 'Bad-Name', value: 'x' }]), 400, 'a bad name');
      return `${variables.length} of the account’s own kept`;
    });
  } finally {
    if (variables) {
      await check('variables put back as they were', async () => {
        const saved = variables as Variable[];
        await updateUserVariables(client, saved);
        if (JSON.stringify(await getUserVariables(client)) !== JSON.stringify(saved)) throw new Error('the variables differ from before');
        return 'identical';
      });
    }
  }

  // ── Password: refused with a wrong current one; never changed ──
  if (config?.features?.enable_login_form === false || config?.features?.enable_password_change_form === false) {
    steps.push({ name: 'password', ok: true, note: 'skipped: the admin turned password changes off' });
  } else {
    await check('password: a wrong current password refused (400), still signed in', async () => {
      await refused(() => updatePassword(client, `app-probe-wrong-${Date.now()}`, `app-probe-new-${Date.now()}`), 400, 'a wrong password');
      await getSessionUser(client);
      return 'refused; the token still works';
    });
  }

  // ── API key ──
  if (!capabilities.feature('apiKeys')) {
    await check('API key: refused for this account (403)', async () => {
      await refused(() => getApiKey(client), 403, 'reading the key');
      return 'refused, as the web hides it';
    });
  } else {
    let made = false;
    try {
      await check('API key: made, read and removed', async () => {
        if (await getApiKey(client)) return 'skipped: the account has a key, and making one would replace it';
        const key = await createApiKey(client);
        made = true;
        if (!key.startsWith('sk-')) throw new Error('not an sk- key');
        if ((await getApiKey(client)) !== key) throw new Error('read back a different key');
        await deleteApiKey(client);
        made = false;
        if (await getApiKey(client)) throw new Error('still there after removing');
        return 'none before and after';
      });
    } finally {
      if (made) await deleteApiKey(client).catch(() => undefined);
    }
  }

  return { steps, fixture };
}
