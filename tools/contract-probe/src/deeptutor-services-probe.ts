import { deleteMcpServer, DtHttpError, getCliApps, getCliCatalog, getMcpCatalog, getMcpState, installMcpEntry, saveMcpServer, testMcpServer, type DtClient } from '@maviechat/deeptutor-protocol';
import { shapeOf } from './shape';

/** The refusal code (or HTTP status) a call ends with; 'ok' when it works. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (error) {
    if (error instanceof DtHttpError) return error.code ?? String(error.status);
    throw error;
  }
}

/**
 * B7.4 against a live DeepTutor, in the test account, without reaching any MCP server: the
 * account's servers (it has none, so reading connects nothing); both stores read and paged;
 * saves DeepTutor must refuse before connecting (a bad and a reserved name, a program on the
 * server, a loopback address; no credentials sent); a test of a loopback address refused; a
 * delete and a sign-in of a server that isn't there; installs refused (a missing credential, an
 * admin-only entry); CLI apps and their store read.
 */
export async function probeServices(client: DtClient): Promise<{ note: string; fixture: Record<string, unknown> }> {
  const fixture: Record<string, unknown> = {};
  const before = await getMcpState(client);
  if (before.servers.length) throw new Error('the test account has MCP servers: reading them would connect to them, so this probe stops');
  fixture.state = { servers: before.servers.length, rejected: before.rejected.length, deployment: before.deployment.length, maxServers: before.maxServers };

  const first = await getMcpCatalog(client, { limit: 30 });
  let entries = first.entries;
  for (let next = first.next, pages = 0; next && pages < 10; pages += 1) {
    const page = await getMcpCatalog(client, { limit: 30, cursor: next });
    entries = [...entries, ...page.entries];
    next = page.next;
  }
  if (entries.length !== first.total) throw new Error(`the store pages gave ${entries.length} entries of ${first.total}`);
  const raw = await client.get<{ entries?: unknown[] }>('/api/space/mcp/catalog', { query: { limit: 1 } });
  fixture.catalog = { total: first.total, categories: first.categories, withFields: entries.filter((entry) => entry.fields.length).length, entry: shapeOf(raw.entries?.[0], 3) };
  const searched = await getMcpCatalog(client, { q: 'search' });
  fixture.catalogSearch = searched.total;

  const refusals: Record<string, string> = {};
  refusals.badName = await refusalOf(() => saveMcpServer(client, 'bad name', { url: 'http://127.0.0.1:9/mcp' }));
  refusals.reservedName = await refusalOf(() => saveMcpServer(client, 'mcp_probe', { url: 'http://127.0.0.1:9/mcp' }));
  refusals.program = await refusalOf(() => saveMcpServer(client, 'mc-probe-program', { command: 'echo', args: ['hi'] }));
  refusals.loopback = await refusalOf(() => saveMcpServer(client, 'mc-probe-local', { url: 'http://127.0.0.1:9/mcp' }));
  const test = await testMcpServer(client, 'mc-probe-local', { url: 'http://127.0.0.1:9/mcp' });
  refusals.testLoopback = test.ok ? 'ok' : 'refused';
  refusals.deleteAbsent = await refusalOf(() => deleteMcpServer(client, 'mc-probe-absent'));
  refusals.authorizeAbsent = await refusalOf(() => client.post('/api/space/mcp/servers/mc-probe-absent/authorize'));
  const needing = entries.find((entry) => entry.fields.some((field) => field.required));
  if (needing) refusals.missingCredential = await refusalOf(() => installMcpEntry(client, needing.id, {}));
  refusals.adminOnly = await refusalOf(() => installMcpEntry(client, 'fetch', {}));
  fixture.refusals = refusals;
  const expected: Record<string, string> = { badName: 'mcp.invalid_name', reservedName: 'mcp.name_reserved', program: 'mcp.stdio_not_allowed', loopback: 'mcp.blocked_url', testLoopback: 'refused', deleteAbsent: 'ok', authorizeAbsent: '404' };
  if (needing) expected.missingCredential = 'mcp.missing_credential';
  for (const [key, want] of Object.entries(expected)) if (refusals[key] !== want) throw new Error(`${key}: expected ${want}, got ${refusals[key]}`);
  if (refusals.adminOnly !== 'mcp.entry_admin_only' && refusals.adminOnly !== '404') throw new Error(`installing an admin-only entry gave ${refusals.adminOnly}`);
  const after = await getMcpState(client);
  if (after.servers.length) throw new Error('a refused save or install left a server behind');

  const cli = await getCliApps(client);
  const installable = await getCliCatalog(client, {});
  const all = await getCliCatalog(client, { installableOnly: false });
  const rawCli = await client.get<{ entries?: unknown[] }>('/api/space/cli-apps/catalog', { query: { limit: 1 } });
  fixture.cli = { apps: cli.apps.length, installable: installable.total, all: all.total, categories: Object.keys(all.categories).length, entry: shapeOf(rawCli.entries?.[0], 3) };
  if (all.total < installable.total) throw new Error('the whole CLI store is smaller than its installable part');

  return {
    note: `no MCP servers of its own; the store has ${first.total} entries (${(fixture.catalog as { withFields: number }).withFields} ask for credentials); saves, tests and installs refused before connecting (${Object.keys(expected).length + 1} checks); ${cli.apps.length} CLI apps, the CLI store ${installable.total} installable of ${all.total}`,
    fixture,
  };
}
