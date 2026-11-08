import { createAdminFunction, createWorkspaceTool, frontmatterOf, importedCode, loadCodeFromLink, type CodeKind } from '@maviechat/owui-protocol';
import { Alert } from 'react-native';
import { showPrompt } from '@/components/dialogs';
import { useToast } from '@/components/Toast';
import { pickTextFile } from '@/features/workspace/EditorParts';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import type { CodeTarget } from './CodeEditorSheet';

/**
 * The web's imports for tools and functions: from a link (admins; the server fetches it) or from
 * an export file. One item opens in the editor to look at before saving; several are saved after
 * a warning, as the web's Import does, with what failed said after.
 */
export function useCodeImport(kind: CodeKind, open: (target: CodeTarget) => void, saved: () => void) {
  const { client } = useAuthed();
  const toast = useToast();
  const noun = kind === 'tools' ? 'tool' : 'function';

  const load = async (url: string) => {
    if (!/^https?:\/\/\S+$/i.test(url.trim())) return toast('The link starts with https://.', 'error');
    try {
      const loaded = await loadCodeFromLink(client, kind, url);
      const header = frontmatterOf(loaded.content);
      open({ kind, id: null, name: header.title || loaded.name, description: header.description ?? '', content: loaded.content, imported: true });
    } catch (error) {
      toast(`Couldn’t load it: ${describeError(error)}`, 'error');
    }
  };

  const fromLink = () =>
    showPrompt(
      'Import From Link',
      `A link to the ${noun}’s code: a .py file, or its page on GitHub. It opens in the editor; nothing runs until you save it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Load', onPress: (value?: string) => void load(value ?? '') },
      ],
      'plain-text',
      '',
      'url',
    );

  const importAll = async (items: ReturnType<typeof importedCode>) => {
    const failed: string[] = [];
    for (const item of items) {
      try {
        if (kind === 'tools') await createWorkspaceTool(client, item);
        else await createAdminFunction(client, item);
      } catch (error) {
        failed.push(`${item.name}: ${describeError(error)}`);
      }
    }
    saved();
    if (failed.length) Alert.alert(`Imported ${items.length - failed.length} of ${items.length}`, failed.join('\n\n'));
    else toast(`Imported ${items.length} ${noun}s`);
  };

  const fromFile = async () => {
    let items: ReturnType<typeof importedCode>;
    try {
      const file = await pickTextFile('application/json');
      if (!file) return;
      items = importedCode(JSON.parse(file.text));
    } catch (error) {
      return toast(`Couldn’t read the file: ${describeError(error)}`, 'error');
    }
    const first = items[0];
    if (!first) return toast(`There’s no ${noun} in that file.`, 'error');
    if (items.length === 1) return open({ kind, id: null, name: first.name, description: first.description, content: first.content, suggestedId: first.id, imported: true });
    Alert.alert(`Import ${items.length} ${noun}s?`, `Each one’s code runs on your server as it’s saved, and may install packages there. Only import a file you trust.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Import', style: 'destructive', onPress: () => void importAll(items) },
    ]);
  };

  return { fromLink, fromFile: () => void fromFile() };
}
