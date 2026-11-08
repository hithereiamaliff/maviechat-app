import {
  createAdminFunction,
  createWorkspaceTool,
  deleteAdminFunction,
  deleteWorkspaceTool,
  formatPythonCode,
  getAdminFunction,
  getWorkspaceTool,
  loadCodeFromLink,
  OwuiHttpError,
  updateAdminFunction,
  updateWorkspaceTool,
  type Capabilities,
  type OwuiClient,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const TOOL = 'app_probe_code_tool';
const FILTER = 'app_probe_code_filter';
const toolCode = (word: string) => `"""\ntitle: APP PROBE tool\n"""\n\n\nclass Tools:\n    def repeat(self, text: str) -> str:\n        """Repeat the text (${word})."""\n        return text\n`;
const filterCode = (word: string) => `"""\ntitle: APP PROBE filter\n"""\n\n\nclass Filter:\n    def inlet(self, body: dict) -> dict:\n        # ${word}\n        return body\n`;
const BROKEN = 'class Tools:\n    def repeat(self\n';
// A public file the server fetches (a read; nothing is saved): a GitHub page, which it turns into
// the raw file. The server reads the part after blob/ as a branch, so a tag there wouldn't do.
const LINK = 'https://github.com/open-webui/open-webui/blob/main/backend/open_webui/constants.py';

/**
 * The code editor's calls, on a scratch server only (saving runs the code there): a tool made,
 * its code and name saved, broken code refused with the old kept; the same for a filter function;
 * the server's formatter; a link loaded (nothing saved). Everything made is deleted after.
 */
export async function probeCodeEdit({ client, capabilities, baseUrl }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'scratch servers only', ok: true, note: 'skipped: saving runs code on the server' });
    return { steps, fixture };
  }
  if (!capabilities.isAdmin) {
    steps.push({ name: 'admins', ok: true, note: 'skipped: functions, the formatter and links are for admins' });
    return { steps, fixture };
  }
  const refused = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (error) {
      if (error instanceof OwuiHttpError && error.status === 400) return 'HTTP 400';
      throw error;
    }
    throw new Error('the server took broken code');
  };

  try {
    await check('a tool made, then its code, name and what it’s for saved; broken code refused, the old kept', async () => {
      await createWorkspaceTool(client, { id: TOOL, name: 'APP PROBE tool', description: 'first', content: toolCode('first') });
      await updateWorkspaceTool(client, TOOL, { name: 'APP PROBE tool 2', description: 'second', content: toolCode('second') });
      const saved = await getWorkspaceTool(client, TOOL);
      if (saved.name !== 'APP PROBE tool 2' || saved.description !== 'second' || !saved.content?.includes('(second)')) throw new Error('the change wasn’t kept');
      const refusal = await refused(() => updateWorkspaceTool(client, TOOL, { name: 'APP PROBE tool 2', description: 'second', content: BROKEN }));
      const after = await getWorkspaceTool(client, TOOL);
      if (!after.content?.includes('(second)')) throw new Error('the broken code replaced the old');
      fixture.tool = { manifest: Object.keys(after.manifest).sort() };
      return `saved; broken code ${refusal}, the old kept; header read (${Object.keys(after.manifest).join(', ') || 'none'})`;
    });

    await check('a filter function made, then saved; broken code refused, the old kept', async () => {
      await createAdminFunction(client, { id: FILTER, name: 'APP PROBE filter', description: 'first', content: filterCode('first') });
      await updateAdminFunction(client, FILTER, { name: 'APP PROBE filter', description: 'second', content: filterCode('second') });
      const saved = await getAdminFunction(client, FILTER);
      if (saved.description !== 'second' || !saved.content?.includes('# second') || saved.type !== 'filter') throw new Error('the change wasn’t kept');
      const refusal = await refused(() => updateAdminFunction(client, FILTER, { name: 'APP PROBE filter', description: 'second', content: BROKEN }));
      const after = await getAdminFunction(client, FILTER);
      if (!after.content?.includes('# second')) throw new Error('the broken code replaced the old');
      return `saved as a filter; broken code ${refusal}, the old kept`;
    });

    await check('the server’s formatter', async () => {
      const tidy = await formatPythonCode(client, 'x=1\nif x :\n  y=2\n');
      if (tidy !== 'x = 1\nif x:\n    y = 2\n') throw new Error('not formatted as expected');
      const broken = await refused(() => formatPythonCode(client, BROKEN));
      return `tidied; broken code ${broken}`;
    });

    await check('a link loaded (a GitHub page made the raw file; nothing saved)', async () => {
      const loaded = await loadCodeFromLink(client, 'tools', LINK);
      fixture.link = { name: loaded.name, bytes: loaded.content.length };
      if (!loaded.content.length) throw new Error('no code');
      return `named ${loaded.name}, ${loaded.content.length} characters`;
    });
  } finally {
    await deleteWorkspaceTool(client, TOOL).catch(() => undefined);
    await deleteAdminFunction(client, FILTER).catch(() => undefined);
  }

  await check('the tool and the function deleted', async () => {
    const tool = await getWorkspaceTool(client, TOOL).then(() => true, () => false);
    const fn = await getAdminFunction(client, FILTER).then(() => true, () => false);
    if (tool || fn) throw new Error('something is still there');
    return 'none left';
  });
  return { steps, fixture };
}
