import {
  addGroupMembers,
  addUser,
  createAdminGroup,
  dataWithShare,
  deleteAdminGroup,
  deleteUser,
  effectivePermissions,
  getAdminGroup,
  getAdminUser,
  getDefaultPermissions,
  getStockPermissions,
  groupMembers,
  listAdminGroups,
  listAdminUsers,
  listAllUsers,
  OwuiHttpError,
  permissionChanges,
  permissionTreeOf,
  removeGroupMembers,
  saveDefaultPermissions,
  signIn,
  signOut,
  updateAdminGroup,
  updateUser,
  userAccess,
  withPermissions,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof OwuiHttpError) return error.status;
    throw error;
  }
}

/**
 * M4.1: Admin → users, groups and permissions. A non-admin is refused the user list. Only on the
 * scratch instance (`allowWrites`, as an admin): users listed and counted; a probe user added
 * (pending), approved, renamed, given a new password, read back with what it can reach; a probe
 * group made from the defaults, renamed, its sharing rule changed, the probe user added and
 * removed; the probe user's own permissions checked against the "defaults OR groups" rule while
 * in the group; the default permissions changed by one switch and put back exactly; everything
 * the probe made deleted.
 */
export async function probeM4Users({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };

  if (!capabilities.isAdmin) {
    await step('admin: the user list refused to a non-admin', async () => {
      const status = await statusOf(() => listAdminUsers(client, {}));
      if (status === 200) throw new Error('a non-admin read the user list');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  await step('admin: users listed and counted', async () => {
    const page = await listAdminUsers(client, { orderBy: 'created_at', direction: 'asc' });
    const all = await listAllUsers(client);
    fixture.users = { total: page.total, pending: all.filter((user) => user.role === 'pending').length };
    if (page.total !== all.length) throw new Error(`the list says ${page.total}, everyone is ${all.length}`);
    return `${page.total} users, ${fixture.users && (fixture.users as { pending: number }).pending} waiting for approval`;
  });

  if (!allowWrites) return { steps, fixture };

  const stamp = Date.now().toString(36);
  const email = `app-probe-${stamp}@maviechat.invalid`;
  // Made for this run only, then deleted with the user.
  const password = `Probe-${stamp}-${Math.random().toString(36).slice(2, 10)}`;
  let userId = '';
  let groupId = '';
  const defaultsBefore = await getDefaultPermissions(client);
  try {
    await step('admin: a probe user added, approved, renamed, given a new password', async () => {
      const made = await addUser(client, { name: 'APP PROBE user', email, password: `${password}-first`, role: 'pending' });
      userId = made.id;
      if (made.role !== 'pending') throw new Error(`it came in as ${made.role}`);
      await updateUser(client, userId, { role: 'user', name: 'APP PROBE user renamed', password });
      const read = await getAdminUser(client, userId);
      if (read.role !== 'user' || read.name !== 'APP PROBE user renamed') throw new Error('approving or renaming didn’t take');
      const stale = await statusOf(() => signIn(client.withToken(null), email, `${password}-first`));
      if (stale === 200) throw new Error('the old password still signs in');
      const access = await userAccess(client, userId);
      return `added (pending), approved, renamed; the old password refused (${stale}); reaches ${access.models.items.length} of ${access.models.total} models`;
    });

    await step('admin: a group from the defaults, renamed, sharing rule set, a member added; their permissions follow “defaults or groups”', async () => {
      if (!userId) throw new Error('no probe user');
      const tree = withPermissions(defaultsBefore, { 'workspace.models': true });
      const made = await createAdminGroup(client, { name: `APP PROBE group ${stamp}`, description: 'APP PROBE', permissions: tree });
      groupId = made.id;
      await updateAdminGroup(client, made, { name: `APP PROBE group ${stamp} renamed`, data: dataWithShare(made.data, 'nobody') });
      const read = await getAdminGroup(client, groupId);
      if (read.name !== `APP PROBE group ${stamp} renamed` || read.shareWith !== 'nobody') throw new Error('renaming or the sharing rule didn’t take');
      if (permissionChanges(tree, read.permissions).length) throw new Error(`the stored permissions differ in ${permissionChanges(tree, read.permissions).join(', ')}`);
      await addGroupMembers(client, groupId, [userId, 'no-such-user']);
      const members = await groupMembers(client, groupId);
      if (!members.some((member) => member.id === userId) || members.length !== 1) throw new Error(`members: ${members.length}`);
      const session = await signIn(client.withToken(null), email, password);
      if (session.kind !== 'session') throw new Error('the probe user couldn’t sign in');
      const own = client.withToken(session.session.token);
      try {
        const theirs = permissionTreeOf(await own.get<unknown>('/api/v1/users/permissions')) ?? {};
        const expected = effectivePermissions(defaultsBefore, [read.permissions]);
        const differs = permissionChanges(expected, theirs);
        fixture.mergeDiffers = differs;
        if (differs.length) throw new Error(`the server worked out ${differs.join(', ')} differently`);
      } finally {
        await signOut(own).catch(() => undefined);
      }
      await removeGroupMembers(client, groupId, [userId]);
      if ((await groupMembers(client, groupId)).length) throw new Error('removing the member didn’t take');
      return 'made from the defaults (stored as sent), renamed, nobody may share with it; the member’s permissions match defaults OR group; removed again';
    });

    await step('admin: the default permissions changed by one switch, then put back exactly', async () => {
      const flipped = withPermissions(defaultsBefore, { 'features.notes': !(defaultsBefore.features?.notes ?? true) });
      await saveDefaultPermissions(client, flipped);
      const changed = await getDefaultPermissions(client);
      const what = permissionChanges(defaultsBefore, changed);
      if (what.join() !== 'features.notes') throw new Error(`saving one switch changed: ${what.join(', ') || 'nothing'}`);
      await saveDefaultPermissions(client, defaultsBefore);
      const after = await getDefaultPermissions(client);
      if (permissionChanges(defaultsBefore, after).length) throw new Error('putting it back left a difference');
      const stock = await getStockPermissions(client);
      fixture.stockDiffers = permissionChanges(stock, defaultsBefore);
      return `one switch, then back exactly; this server differs from its stock defaults in ${(fixture.stockDiffers as string[]).length} switches`;
    });
  } finally {
    if (groupId) await deleteAdminGroup(client, groupId).catch(() => undefined);
    if (userId) await deleteUser(client, userId).catch(() => undefined);
    const now = await getDefaultPermissions(client).catch(() => null);
    if (now && permissionChanges(defaultsBefore, now).length) await saveDefaultPermissions(client, defaultsBefore).catch(() => undefined);
  }

  await step('admin: the probe user and group are gone', async () => {
    const user = userId ? await statusOf(() => getAdminUser(client, userId)) : 0;
    const group = groupId ? (await listAdminGroups(client)).some((item) => item.id === groupId) : false;
    if (user === 200 || group) throw new Error('something is still there');
    return `the user reads ${user}; the group isn’t listed`;
  });
  return { steps, fixture };
}
