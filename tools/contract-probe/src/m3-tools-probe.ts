import {
  createWorkspaceTool,
  deleteWorkspaceTool,
  exportWorkspaceTools,
  getToolValves,
  getToolValvesSpec,
  getWorkspaceTool,
  listWorkspaceTools,
  OwuiHttpError,
  updateAccess,
  updateToolValves,
  valveFields,
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

/** The probe's own tool: no packages to install, nothing it reaches out to; three valves (one secret). */
const PROBE_TOOL = `"""
title: APP PROBE tool
version: 0.0.1
description: Made and deleted by the MavieChat contract probe.
"""

from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        api_key: str = Field(default="", description="A secret it never uses", json_schema_extra={"input": {"type": "password"}})
        limit: int = Field(default=3, description="How many")
        tags: list[str] = Field(default_factory=list, description="Labels")

    def __init__(self):
        self.valves = self.Valves()

    def echo(self, text: str) -> str:
        """
        Says the text back.
        :param text: what to say back
        """
        return text
`;

/**
 * M3.6: tools. Everywhere: the list reads (a readable tool too; its code only for writers) and
 * export answers as the account's permission says. Only on the scratch instance (`allowCode`,
 * as saving a tool runs it on the server): a probe tool made, its shared valves read (the secret
 * one marked), set, partly reset to defaults, its sharing changed, exported with its code, deleted.
 */
export async function probeM3Tools({ client, capabilities, allowCode }: { client: OwuiClient; capabilities: Capabilities; allowCode: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  const canExport = capabilities.isAdmin || capabilities.can('workspace.tools_export');

  await step('tools: the list reads', async () => {
    const tools = await listWorkspaceTools(client);
    fixture.count = tools.length;
    const first = tools[0];
    if (!first) return 'none readable';
    const one = await getWorkspaceTool(client, first.id);
    if (!one.writeAccess && one.content !== null) throw new Error('a read-only tool came with its code');
    return `${tools.length} readable; one read back (${one.writeAccess ? 'with its code, as a writer' : 'without its code, read-only'})`;
  });

  await step('tools: export as the permission says', async () => {
    const status = await statusOf(() => exportWorkspaceTools(client));
    fixture.export = status;
    if (canExport ? status !== 200 : status === 200) throw new Error(`export gave ${status} ${canExport ? 'with' : 'without'} workspace.tools_export`);
    return canExport ? 'allowed' : `refused (${status})`;
  });

  if (!allowCode) return { steps, fixture };

  const id = `app_probe_${Date.now().toString(36)}`;
  try {
    await step('tools: a probe tool made, its shared valves set and reset, shared, exported, deleted', async () => {
      const made = await createWorkspaceTool(client, { id, name: 'APP PROBE tool', description: 'APP PROBE', content: PROBE_TOOL });
      if (made.version !== '0.0.1') throw new Error(`its header read as version “${made.version}”`);
      const fields = valveFields(await getToolValvesSpec(client, id));
      const kinds = Object.fromEntries(fields.map((field) => [field.key, field.kind]));
      fixture.valveKinds = kinds;
      if (kinds.api_key !== 'password' || kinds.limit !== 'integer' || kinds.tags !== 'list') throw new Error(`the valves read as ${JSON.stringify(kinds)}`);
      if (Object.keys(await getToolValves(client, id)).length) throw new Error('a new tool had values set');
      await updateToolValves(client, id, { api_key: 'not-a-real-secret', limit: 5, tags: ['a', 'b'] });
      const set = await getToolValves(client, id);
      if (set.limit !== 5 || set.api_key !== 'not-a-real-secret') throw new Error('the values didn’t take');
      await updateToolValves(client, id, { api_key: null, limit: 7, tags: null });
      const reset = await getToolValves(client, id);
      fixture.resetDropsNulls = !('api_key' in reset) && !('tags' in reset);
      if (reset.limit !== 7 || 'api_key' in reset) throw new Error(`nulls didn’t go back to the defaults: ${Object.keys(reset).join(', ')}`);
      // Everyone may use it: an admin's share is kept; anyone else's is dropped (0.11) or refused (0.12, 403).
      const everyoneAllowed = capabilities.isAdmin || capabilities.can('sharing.public_tools');
      let shared: 'kept' | 'dropped' | 'refused';
      try {
        const kept = await updateAccess(client, 'tools', id, [{ principal_type: 'user', principal_id: '*', permission: 'read' }]);
        shared = kept.some((grant) => grant.principal_id === '*') ? 'kept' : 'dropped';
      } catch (error) {
        if (!(error instanceof OwuiHttpError) || error.status !== 403) throw error;
        shared = 'refused';
      }
      if ((shared === 'kept') !== everyoneAllowed) throw new Error(`sharing with everyone was ${shared}, though this account ${everyoneAllowed ? 'may' : 'may not'}`);
      await updateAccess(client, 'tools', id, []);
      let exportNote = 'export not allowed for this account';
      if (canExport) {
        const exported = await exportWorkspaceTools(client);
        const entry = exported.find((row) => typeof row === 'object' && row !== null && (row as { id?: unknown }).id === id) as { content?: unknown } | undefined;
        if (typeof entry?.content !== 'string' || !entry.content.includes('class Tools')) throw new Error('the export lacked its code');
        exportNote = 'exported with its code';
      }
      await deleteWorkspaceTool(client, id);
      const gone = await statusOf(() => getWorkspaceTool(client, id));
      if (gone === 200) throw new Error('still there after deleting');
      return `made (its header read); valves: a secret, a number and a list; set, then nulls back to defaults; everyone ${shared}, then private; ${exportNote}; deleted (${gone})`;
    });
  } finally {
    await deleteWorkspaceTool(client, id).catch(() => undefined);
  }
  return { steps, fixture };
}
