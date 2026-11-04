import {
  CHAT_SECTIONS,
  CODE_EXECUTION_SECTIONS,
  getChatConfig,
  getCodeExecutionConfig,
  getSubagentsConfig,
  getTaskConfig,
  getWebConfig,
  OwuiHttpError,
  saveChatConfig,
  saveCodeExecutionConfig,
  saveSubagentsConfig,
  saveTaskConfig,
  saveWebConfig,
  settingChanges,
  settingsPayload,
  SUBAGENT_SECTIONS,
  TASK_SECTIONS,
  WEB_SEARCH_SECTIONS,
  type Capabilities,
  type OwuiClient,
  type SettingEdits,
  type SettingSection,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;

async function statusOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof OwuiHttpError) return error.status;
    throw error;
  }
}

const differing = (a: Tree, b: Tree) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));

interface Page {
  name: string;
  sections: SettingSection[];
  read: (client: OwuiClient) => Promise<Tree>;
  save: (client: OwuiClient, config: Tree) => Promise<unknown>;
  /** One harmless edit, and how to put it back. */
  edit: (stored: Tree) => { key: string; to: string; back: string };
}

const PAGES: Page[] = [
  { name: 'background tasks', sections: TASK_SECTIONS, read: getTaskConfig, save: saveTaskConfig, edit: (stored) => ({ key: 'TITLE_GENERATION_PROMPT_TEMPLATE', to: 'APP PROBE title prompt', back: String(stored.TITLE_GENERATION_PROMPT_TEMPLATE ?? '') }) },
  { name: 'chat', sections: CHAT_SECTIONS, read: getChatConfig, save: saveChatConfig, edit: (stored) => ({ key: 'CONTEXT_COMPACTION_RETENTION_PERCENTAGE', to: stored.CONTEXT_COMPACTION_RETENTION_PERCENTAGE === 41 ? '42' : '41', back: String(stored.CONTEXT_COMPACTION_RETENTION_PERCENTAGE ?? '') }) },
  { name: 'sub-agents', sections: SUBAGENT_SECTIONS, read: getSubagentsConfig, save: saveSubagentsConfig, edit: (stored) => ({ key: 'SUBAGENTS_MAX_OUTPUT', to: String(Number(stored.SUBAGENTS_MAX_OUTPUT ?? 30000) + 1), back: String(stored.SUBAGENTS_MAX_OUTPUT ?? '') }) },
  { name: 'web search', sections: WEB_SEARCH_SECTIONS, read: getWebConfig, save: saveWebConfig, edit: (stored) => ({ key: 'WEB_SEARCH_RESULT_COUNT', to: String(Number(stored.WEB_SEARCH_RESULT_COUNT ?? 3) + 1), back: String(stored.WEB_SEARCH_RESULT_COUNT ?? '') }) },
  { name: 'code execution', sections: CODE_EXECUTION_SECTIONS, read: getCodeExecutionConfig, save: saveCodeExecutionConfig, edit: (stored) => ({ key: 'CODE_EXECUTION_JUPYTER_TIMEOUT', to: String(Number(stored.CODE_EXECUTION_JUPYTER_TIMEOUT ?? 60) + 1), back: stored.CODE_EXECUTION_JUPYTER_TIMEOUT === null ? '' : String(stored.CODE_EXECUTION_JUPYTER_TIMEOUT ?? '') }) },
];

/**
 * M4.5 and M4.8: the Interface, Sub-agents, Web Search and Code Execution pages. A non-admin is refused. On every
 * server: each page's fields are all in its endpoint's answer, and no edits make no request. Only
 * on the scratch instance: one harmless edit per endpoint, laid over a fresh read, changes that
 * key (other keys the server rewrites on any save are reported), and putting it back restores it.
 */
export async function probeM4Forms({ client, capabilities, allowWrites }: { client: OwuiClient; capabilities: Capabilities; allowWrites: boolean }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    await step('admin forms: the chat settings refused to a non-admin', async () => {
      const status = await statusOf(() => getChatConfig(client));
      if (status === 200) throw new Error('a non-admin read the chat settings');
      return `refused (${status})`;
    });
    return { steps, fixture };
  }

  for (const page of PAGES) {
    const fields = page.sections.flatMap((section) => section.fields);
    await step(`admin forms: ${page.name}`, async () => {
      const before = await page.read(client);
      const missing = fields.filter((field) => !(field.key in before)).map((field) => field.key);
      if (missing.length) throw new Error(`not in this server’s answer: ${missing.join(', ')}`);
      if (settingChanges(fields, before, {}).length) throw new Error('no edits still found changes');
      if (!allowWrites) return `${fields.length} fields, all there; no edits, no request`;
      const { key, to, back } = page.edit(before);
      const edits: SettingEdits = { [key]: to };
      await page.save(client, settingsPayload(fields, await page.read(client), before, edits));
      const changed = await page.read(client);
      const what = differing(before, changed);
      if (!what.includes(key)) throw new Error('the edit didn’t take');
      const rewritten = what.filter((item) => item !== key);
      fixture[page.name] = { rewritten };
      await page.save(client, settingsPayload(fields, await page.read(client), changed, { [key]: back }));
      const after = await page.read(client);
      if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) throw new Error(`${key} didn’t go back`);
      const left = differing(changed, after).filter((item) => item !== key);
      if (left.length) throw new Error(`putting it back changed ${left.join(', ')} too`);
      return `${fields.length} fields; one edit changed ${key}${rewritten.length ? ` (the server also rewrote ${rewritten.join(', ')} on its first save)` : ' only'}; put back`;
    });
  }
  return { steps, fixture };
}
