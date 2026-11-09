import {
  createWorkspacePrompt,
  deleteWorkspacePrompt,
  diffText,
  getPromptVersion,
  getWorkspacePrompt,
  isAtLeast,
  listPromptVersions,
  OwuiHttpError,
  saveWorkspacePromptVersion,
  unifiedLines,
  type OwuiClient,
  type PromptVersion,
} from '@maviechat/owui-protocol';
import type { WriteStep } from './write-probe';

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

const FIRST = 'You are a helpful assistant.\nAnswer briefly.\nUse British spelling.\n\nSign off with a smile.';
const SECOND = 'You are a helpful assistant.\nAnswer in detail, with examples.\nUse British spelling.\nCite sources.\n\nSign off with a smile.';
const THIRD = 'You are a careful assistant.\nAnswer in detail, with examples.\nUse British spelling.\nCite sources.\nSay when you are unsure.\n\nSign off with a smile.';

/**
 * Comparing a prompt's versions, the app's way (scratch servers only: it makes a prompt). A
 * throwaway prompt gets versions: new text, a new name and tags (live), more text (kept aside),
 * and the same text with other line breaks. The app works out each comparison from the versions'
 * saved text. On 0.12 it must match the server's own comparison line for line (with the name
 * change and "line breaks only"). On 0.11 the server's comparison can't be reached (its route
 * comes after the one for a single version), which is why the app works it out itself. A version
 * read on its own matches the listed one. The prompt is deleted after.
 */
export async function probePromptDiff({ client, version, baseUrl }: { client: OwuiClient; version: string | undefined; baseUrl: string }): Promise<{ steps: WriteStep[]; fixture: Record<string, unknown> }> {
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
    steps.push({ name: 'prompt version comparison', ok: true, note: 'skipped: scratch servers only' });
    return { steps, fixture };
  }
  const stamp = Date.now().toString(36);
  let promptId = '';
  const serverDiff = (from: string, to: string) => client.get<unknown>(`/api/v1/prompts/id/${encodeURIComponent(promptId)}/history/diff`, { query: { from_id: from, to_id: to } });

  try {
    let versions: PromptVersion[] = [];
    await check('a throwaway prompt with four versions (text, name and tags; kept aside; line breaks only)', async () => {
      let prompt = await createWorkspacePrompt(client, { command: `mc-diff-${stamp}`, name: 'APP PROBE diff', content: FIRST, tags: ['mc-probe'] });
      promptId = prompt.id;
      prompt = await saveWorkspacePromptVersion(client, { ...prompt, name: 'APP PROBE diff renamed', tags: ['mc-probe', 'mc-probe-2'] }, { content: SECOND, commitMessage: 'more detail', live: true });
      prompt = await saveWorkspacePromptVersion(client, await getWorkspacePrompt(client, promptId), { content: THIRD, commitMessage: 'careful', live: false });
      await saveWorkspacePromptVersion(client, await getWorkspacePrompt(client, promptId), { content: THIRD.replace(/\n/g, '\r\n'), commitMessage: 'line breaks', live: false });
      versions = await listPromptVersions(client, promptId);
      if (versions.length !== 4) throw new Error(`${versions.length} versions`);
      if (!versions.every((item) => item.content)) throw new Error('a version came without its text');
      return `4 versions, each with its text, name and tags (${versions.map((item) => item.tags.length).join('/')} tags)`;
    });

    const byNote = (note: string) => versions.find((item) => item.commitMessage === note);
    const pairs = (): [string, PromptVersion, PromptVersion][] => {
      const first = versions[versions.length - 1];
      const detail = byNote('more detail');
      const careful = byNote('careful');
      const breaks = byNote('line breaks');
      if (!first || !detail || !careful || !breaks) throw new Error('the versions aren’t all there');
      return [
        ['the first → the live one', first, detail],
        ['one kept aside → the live one', careful, detail],
        ['the first → one kept aside', first, careful],
        ['line breaks only', careful, breaks],
      ];
    };

    if (isAtLeast(version, '0.12.0')) {
      await check('0.12: the app’s comparison matches the server’s, line for line', async () => {
        const notes: string[] = [];
        for (const [label, from, to] of pairs()) {
          const answer = record(await serverDiff(from.id, to.id));
          const server = (Array.isArray(answer.content_diff) ? answer.content_diff : []).map(String).slice(2);
          const ours = diffText(from.content, to.content);
          if (JSON.stringify(unifiedLines(ours)) !== JSON.stringify(server)) throw new Error(`${label}: the lines differ (${unifiedLines(ours).length} here, ${server.length} on the server)`);
          if (Boolean(answer.line_endings_only) !== ours.lineEndingsOnly) throw new Error(`${label}: “line breaks only” differs`);
          if (Boolean(answer.name_changed) !== (from.name !== to.name)) throw new Error(`${label}: the name change differs`);
          notes.push(`${label}: ${ours.lineEndingsOnly ? 'line breaks only' : `−${ours.removed} +${ours.added}`}${from.name !== to.name ? ', renamed' : ''}`);
        }
        return notes.join('; ');
      });
    } else {
      await check('0.11: the server’s own comparison can’t be reached, so the app works it out', async () => {
        const [, from, to] = pairs()[0] ?? [];
        if (!from || !to) throw new Error('no versions');
        const status = await serverDiff(from.id, to.id).then(
          () => 200,
          (error: unknown) => {
            if (error instanceof OwuiHttpError) return error.status;
            throw error;
          },
        );
        fixture.serverDiff = status;
        if (status === 200) throw new Error('the server compared them after all');
        const ours = diffText(from.content, to.content);
        if (ours.removed !== 1 || ours.added !== 2) throw new Error(`the app found −${ours.removed} +${ours.added}`);
        return `the server answered ${status}; the app found −${ours.removed} +${ours.added} from the versions’ text`;
      });
    }

    await check('the live version read on its own matches the listed one', async () => {
      const prompt = await getWorkspacePrompt(client, promptId);
      if (!prompt.versionId) throw new Error('no live version');
      const alone = await getPromptVersion(client, promptId, prompt.versionId);
      const listed = versions.find((item) => item.id === prompt.versionId);
      if (!listed || alone.content !== listed.content || alone.name !== listed.name || alone.tags.join() !== listed.tags.join()) throw new Error('they differ');
      return `the same text, name and tags (“${alone.commitMessage || 'no note'}”)`;
    });
  } finally {
    if (promptId) {
      await check('the throwaway prompt deleted', async () => {
        await deleteWorkspacePrompt(client, promptId);
        return 'gone';
      });
    }
  }
  return { steps, fixture };
}
