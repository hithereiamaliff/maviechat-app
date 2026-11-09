import {
  compareCodeVersions,
  createAdminFunction,
  createWorkspaceSkill,
  createWorkspaceTool,
  deleteAdminFunction,
  deleteCodeVersion,
  deleteWorkspaceSkill,
  deleteWorkspaceTool,
  diffText,
  getCodeVersion,
  isAtLeast,
  listCodeVersions,
  liveCodeVersionId,
  makeCodeVersionLive,
  OwuiHttpError,
  unifiedLines,
  updateAdminFunction,
  updateWorkspaceSkill,
  updateWorkspaceTool,
  type Capabilities,
  type OwuiClient,
  type VersionedKind,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

const toolCode = (word: string, extra = '') => `"""\ntitle: APP PROBE versions tool\n"""\n\n\nclass Tools:\n    def repeat(self, text: str) -> str:\n        """Repeat the text (${word})."""\n${extra}        return text\n`;
const filterCode = (word: string, extra = '') => `"""\ntitle: APP PROBE versions filter\n"""\n\n\nclass Filter:\n    def inlet(self, body: dict) -> dict:\n        # ${word}\n${extra}        return body\n`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const skillText = (word: string, extra = '') => `---\nname: app-probe-versions\ndescription: APP PROBE\n---\n\n# Steps\n\n1. Read the ${word}.\n${extra}2. Answer.\n`;

/**
 * Versions of tools, functions and skills, the app's way (0.12 scratch servers only: saving a
 * tool or function runs it). For each: made, then saved twice with notes (one save renames it);
 * three versions listed newest first with their notes and who saved them, the last one live;
 * the first read with its code; the server's comparison of the first and the live one read back
 * line for line as the app's own diff of their code, with the rename; the first made live again
 * (the code back as it was); the live one can't be deleted, another can; a skill made live from a
 * stale version is refused (409). Everything made is deleted after.
 */
export async function probeCodeVersions({ client, capabilities, baseUrl, version }: { client: OwuiClient; capabilities: Capabilities; baseUrl: string; version: string | undefined }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
  const steps: WriteStep[] = [];
  const fixture: Record<string, unknown> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, note: await run() });
    } catch (error) {
      steps.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  };
  if (!isAtLeast(version, '0.12.0') || !capabilities.isAdmin || !/^http:\/\/127\.0\.0\.1:(3013|3014)\/?$/.test(baseUrl)) {
    steps.push({ name: 'versions', ok: true, note: 'skipped: 0.12 scratch servers, as an admin (0.11 keeps no versions)' });
    return { steps, fixture };
  }
  const statusOf = (run: () => Promise<unknown>) =>
    run().then(
      () => 200,
      (error: unknown) => {
        if (error instanceof OwuiHttpError) return error.status;
        throw error;
      },
    );
  const stamp = Date.now().toString(36);
  type Kit = { kind: VersionedKind; id: string; texts: string[]; make: () => Promise<void>; save: (text: string, name: string, note: string) => Promise<void>; remove: () => Promise<void> };
  const kits: Kit[] = [
    {
      kind: 'tools',
      id: `app_probe_ver_tool_${stamp}`,
      texts: [toolCode('one'), toolCode('two', '        # a second step\n'), toolCode('three', '        # a second step\n        # a third\n')],
      make: async () => void (await createWorkspaceTool(client, { id: `app_probe_ver_tool_${stamp}`, name: 'APP PROBE versions tool', description: 'APP PROBE', content: toolCode('one') })),
      save: (content, name, note) => updateWorkspaceTool(client, `app_probe_ver_tool_${stamp}`, { name, description: 'APP PROBE', content, note }),
      remove: () => deleteWorkspaceTool(client, `app_probe_ver_tool_${stamp}`),
    },
    {
      kind: 'functions',
      id: `app_probe_ver_filter_${stamp}`,
      texts: [filterCode('one'), filterCode('two', '        # a second step\n'), filterCode('three', '        # a second step\n        # a third\n')],
      make: async () => void (await createAdminFunction(client, { id: `app_probe_ver_filter_${stamp}`, name: 'APP PROBE versions filter', description: 'APP PROBE', content: filterCode('one') })),
      save: (content, name, note) => updateAdminFunction(client, `app_probe_ver_filter_${stamp}`, { name, description: 'APP PROBE', content, note }),
      remove: () => deleteAdminFunction(client, `app_probe_ver_filter_${stamp}`),
    },
    {
      kind: 'skills',
      id: `app-probe-ver-skill-${stamp}`,
      texts: [skillText('question'), skillText('question twice', '1b. Check it.\n'), skillText('whole question', '1b. Check it.\n1c. Check again.\n')],
      make: async () => void (await createWorkspaceSkill(client, { id: `app-probe-ver-skill-${stamp}`, name: `APP PROBE versions skill ${stamp}`, description: 'APP PROBE', content: skillText('question'), tags: [], isActive: true })),
      save: async (content, name, note) => void (await updateWorkspaceSkill(client, { id: `app-probe-ver-skill-${stamp}`, name, description: 'APP PROBE', content, tags: [], isActive: true, note })),
      remove: () => deleteWorkspaceSkill(client, `app-probe-ver-skill-${stamp}`),
    },
  ];

  for (const kit of kits) {
    let made = false;
    try {
      await check(`${kit.kind}: three saves kept as versions, newest first, the last live`, async () => {
        await kit.make();
        made = true;
        const [, second = '', third = ''] = kit.texts;
        // A second apart, as saves are: the server orders versions by the second they were saved.
        await sleep(1100);
        await kit.save(second, `APP PROBE versions ${kit.kind} ${stamp} renamed`, 'second, renamed');
        await sleep(1100);
        await kit.save(third, `APP PROBE versions ${kit.kind} ${stamp} renamed`, 'third');
        const versions = await listCodeVersions(client, kit.kind, kit.id);
        const live = await liveCodeVersionId(client, kit.kind, kit.id);
        fixture[`${kit.kind}.versions`] = versions.length;
        if (versions.length !== 3) throw new Error(`${versions.length} versions`);
        if (versions.map((item) => item.note).join('|') !== 'third|second, renamed|') throw new Error(`notes: ${versions.map((item) => item.note || '—').join(', ')}`);
        if (live !== versions[0]?.id) throw new Error('the newest isn’t live');
        if (!versions.every((item) => item.author && item.createdAt)) throw new Error('a version without who or when');
        const [newest, middle, first] = versions;
        if (newest?.parentId !== middle?.id || middle?.parentId !== first?.id || first?.parentId !== null) throw new Error('the versions aren’t linked each to the one it was saved over');
        return `3 versions (notes “third”, “second, renamed”, none), each with who and when and linked to the one before; the newest live`;
      });
      if (!made) continue;

      await check(`${kit.kind}: the first read with its code; compared with the live one as the app would draw it`, async () => {
        const versions = await listCodeVersions(client, kit.kind, kit.id);
        const first = versions.at(-1);
        const live = versions[0];
        if (!first || !live) throw new Error('no versions');
        const read = await getCodeVersion(client, kit.kind, kit.id, first.id);
        if (read.snapshot.content !== kit.texts[0]) throw new Error('the first version’s code differs');
        const compared = await compareCodeVersions(client, kit.kind, kit.id, first.id, live.id);
        const ours = diffText(kit.texts[0] ?? '', kit.texts[2] ?? '');
        if (JSON.stringify(unifiedLines(compared.diff)) !== JSON.stringify(unifiedLines(ours))) throw new Error('the server’s comparison reads back differently from the app’s');
        if (!compared.changes.some((change) => change.what === 'Name')) throw new Error('the rename isn’t in the comparison');
        return `the code as saved; −${compared.diff.removed} +${compared.diff.added}, the same lines as the app’s own diff; the rename shown${compared.files.length ? `; ${compared.files.length} other files` : ''}`;
      });

      await check(`${kit.kind}: the first made live again; the live one can’t be deleted, another can`, async () => {
        const versions = await listCodeVersions(client, kit.kind, kit.id);
        const [newest, middle, first] = versions;
        if (!newest || !middle || !first) throw new Error('not three versions');
        if (kit.kind === 'skills') {
          const stale = await statusOf(() => makeCodeVersionLive(client, 'skills', kit.id, first.id, middle.id));
          fixture.staleSkill = stale;
          if (stale !== 409) throw new Error(`a stale skill answered ${stale}`);
        }
        await makeCodeVersionLive(client, kit.kind, kit.id, first.id, newest.id);
        const live = await liveCodeVersionId(client, kit.kind, kit.id);
        if (live !== first.id) throw new Error('the first isn’t live');
        const now = await getCodeVersion(client, kit.kind, kit.id, first.id);
        if (now.snapshot.content !== kit.texts[0]) throw new Error('its code isn’t back');
        const deleteLive = await statusOf(() => deleteCodeVersion(client, kit.kind, kit.id, first.id));
        await deleteCodeVersion(client, kit.kind, kit.id, middle.id);
        const left = await listCodeVersions(client, kit.kind, kit.id);
        if (deleteLive === 200) throw new Error('the live version was deleted');
        if (left.length !== 2 || left.some((item) => item.id === middle.id)) throw new Error(`${left.length} left`);
        return `${kit.kind === 'skills' ? 'from a stale version refused (409); ' : ''}the first live again; deleting it refused (${deleteLive}); the middle one deleted, 2 left`;
      });
    } finally {
      if (made) {
        await check(`${kit.kind}: the throwaway deleted`, async () => {
          await kit.remove();
          return 'gone';
        });
      }
    }
  }
  return { steps, fixture };
}
