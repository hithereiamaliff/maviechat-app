import { DtHttpError, getUserGrants, listAdminUsers, type DtClient } from '@maviechat/deeptutor-protocol';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof DtHttpError) return error.status;
    throw error;
  }
}

/**
 * B9 against a live DeepTutor, as the test account (not an admin): the user list and an account's
 * grants are refused (403) before any work, and its own guardianships read empty. Reads only:
 * DeepTutor's writes here change real accounts, so no write is sent, even to be refused. Checking
 * the admin pages for real needs the owner's admin account, or a scratch DeepTutor.
 */
export async function probeAdmin(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, number | unknown> = {
    users: await statusOf(() => listAdminUsers(client)),
    multiUserUsers: await statusOf(() => client.get('/api/multi-user/users')),
    grants: await statusOf(() => getUserGrants(client, 'mc-probe-nobody')),
  };
  if (fixture.users !== 403 || fixture.multiUserUsers !== 403 || fixture.grants !== 403) throw new Error(`a non-admin was answered ${JSON.stringify(fixture)}, not 403`);
  const mine = await client.get<{ relationships?: unknown[] }>('/api/multi-user/me/guardianships');
  fixture.guardianships = Array.isArray(mine.relationships) ? mine.relationships.length : 'missing';
  return { note: 'the user list, the multi-user list and an account’s grants refused to a non-admin (403); its own guardianships read; no write sent', fixture };
}
