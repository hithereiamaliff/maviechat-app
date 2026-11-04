import {
  createAdminFunction,
  deleteAdminFunction,
  exportAdminFunctions,
  getAdminFunction,
  getSharedValves,
  getSharedValvesSpec,
  listAdminFunctions,
  OwuiHttpError,
  setFunctionActive,
  setFunctionGlobal,
  updateSharedValves,
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

/** The probe's own filter: passes messages through untouched; no packages; two settings. */
const PROBE_FILTER = `"""
title: APP PROBE filter
version: 0.0.1
description: Made and deleted by the MavieChat contract probe.
"""

from pydantic import BaseModel, Field


class Filter:
    class Valves(BaseModel):
        priority: int = Field(default=0, description="Order among filters")
        note: str = Field(default="", description="A note it never uses")

    def __init__(self):
        self.valves = self.Valves()

    def inlet(self, body: dict) -> dict:
        return body

    def outlet(self, body: dict) -> dict:
        return body
`;

/**
 * M4.6: admin functions. A non-admin is refused the list. Only on the scratch instance (saving a
 * function runs it): the probe's pass-through filter made (it starts off), switched on (twice
 * stays on), made global and back, its shared settings set and one put back to its default (left
 * out, not null), exported with its code, deleted.
 */
export async function probeM4Functions({ client, capabilities, allowCode }: { client: OwuiClient; capabilities: Capabilities; allowCode: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    await step('admin functions: refused to a non-admin', async () => {
      const status = await statusOf(() => listAdminFunctions(client));
      if (status === 200) throw new Error('a non-admin read the functions');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  await step('admin functions: listed', async () => {
    const all = await listAdminFunctions(client);
    fixture.count = all.length;
    return `${all.length} functions`;
  });
  if (!allowCode) return { steps, fixture };

  const id = `app_probe_filter_${Date.now().toString(36)}`;
  try {
    await step('admin functions: a probe filter made, switched, made global, its settings set and reset, exported, deleted', async () => {
      const made = await createAdminFunction(client, { id, name: 'APP PROBE filter', description: 'APP PROBE', content: PROBE_FILTER });
      if (made.type !== 'filter' || made.isActive) throw new Error(`it came in as ${made.type}, ${made.isActive ? 'on' : 'off'}`);
      await setFunctionActive(client, id, true);
      await setFunctionActive(client, id, true);
      if (!(await getAdminFunction(client, id)).isActive) throw new Error('switching it on (twice) left it off');
      await setFunctionGlobal(client, id, true);
      if (!(await getAdminFunction(client, id)).isGlobal) throw new Error('making it global didn’t take');
      await setFunctionGlobal(client, id, false);
      const kinds = Object.fromEntries(valveFields(await getSharedValvesSpec(client, 'functions', id)).map((field) => [field.key, field.kind]));
      if (kinds.priority !== 'integer' || kinds.note !== 'text') throw new Error(`its settings read as ${JSON.stringify(kinds)}`);
      await updateSharedValves(client, 'functions', id, { priority: 5, note: 'APP PROBE' });
      await updateSharedValves(client, 'functions', id, { priority: 5, note: null });
      const values = await getSharedValves(client, 'functions', id);
      fixture.afterReset = values;
      if (values.priority !== 5 || 'note' in values) throw new Error(`settings read back as ${JSON.stringify(values)}`);
      const exported = await exportAdminFunctions(client);
      const entry = exported.find((row) => typeof row === 'object' && row !== null && (row as { id?: unknown }).id === id) as { content?: unknown } | undefined;
      if (typeof entry?.content !== 'string' || !entry.content.includes('class Filter')) throw new Error('the export lacked its code');
      await deleteAdminFunction(client, id);
      const gone = await statusOf(() => getAdminFunction(client, id));
      if (gone === 200) throw new Error('still there');
      return `made (a filter, off); on (twice stays on); global and back; settings set, one back to default (left out); exported with its code; deleted (${gone})`;
    });
  } finally {
    await deleteAdminFunction(client, id).catch(() => undefined);
  }
  return { steps, fixture };
}
