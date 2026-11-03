import {
  applyInputVariables,
  attachWebAddress,
  fillBuiltinVariables,
  inputVariables,
  isWebAddress,
  knowledgeAttachment,
  listFolders,
  matchPrompts,
  menuTrigger,
  modelTags,
  pickerModels,
  replaceTrigger,
  uuidv4,
  type InputVariable,
  type MenuTrigger,
  type SavedPrompt,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useKnowledgeSearch, useModels, usePrompts, useSessionUser, useUserSettings } from '@/lib/server';
import { getDraft, patchFile, removeFile, updateDraft } from './drafts';
import type { MenuEntry } from './MentionMenu';

interface Options {
  draftKey: string;
  text: string;
  /** Where the cursor is, and whether the input has focus (the menus show only then). */
  cursor: number;
  focused: boolean;
  setText: (text: string, cursor: number) => void;
  onPickModel: () => void;
  /** The new-chat screen's temporary chat switch. */
  onTemporary?: () => void;
  /** A saved chat's `/fork`: carry on in a copy of the conversation so far. */
  onFork?: () => void;
}

/**
 * The input's menus, as on the web: `/` for commands and your saved prompts (built-in variables
 * filled in, your own asked for in a form); `@` for a model to talk to, knowledge, folders and
 * web pages; `#` for knowledge and web pages.
 */
export function useInputMenus({ draftKey, text, cursor, focused, setText, onPickModel, onTemporary, onFork }: Options) {
  const { client } = useAuthed();
  const toast = useToast();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const user = useSessionUser();
  const trigger = focused ? menuTrigger(text, cursor) : null;
  const query = trigger?.query ?? '';
  const prompts = usePrompts(trigger?.char === '/');
  const knowledge = useKnowledgeSearch(query, trigger?.char === '@' || trigger?.char === '#');
  const models = useModels();
  const foldersOn = capabilities?.feature('folders') ?? false;
  const folders = useQuery({ queryKey: ['folders'], queryFn: () => listFolders(client), enabled: trigger?.char === '@' && foldersOn });
  const [form, setForm] = useState<{ content: string; trigger: MenuTrigger; cursor: number; variables: InputVariable[] } | null>(null);

  const place = (insert: string, at: MenuTrigger = trigger as MenuTrigger, from = cursor) => {
    const next = replaceTrigger(getDraft(draftKey).text, at, from, insert);
    setText(next.text, next.cursor);
  };

  const insertPrompt = async (prompt: SavedPrompt) => {
    if (!trigger) return;
    const at = trigger;
    const from = cursor;
    const clipboard = prompt.content.includes('{{CLIPBOARD}}') ? await Clipboard.getStringAsync().catch(() => '') : undefined;
    const ui = (settings.data?.ui ?? {}) as { language?: string };
    const profile = (user.data ?? {}) as { name?: string; email?: string; bio?: string; gender?: string; date_of_birth?: string };
    const content = fillBuiltinVariables(prompt.content, {
      name: profile.name ?? '',
      email: profile.email,
      bio: profile.bio,
      gender: profile.gender,
      birthDate: profile.date_of_birth,
      language: typeof ui.language === 'string' ? ui.language : undefined,
      clipboard,
    });
    const variables = inputVariables(content);
    if (variables.length) setForm({ content, trigger: at, cursor: from, variables });
    else place(content, at, from);
  };

  const attachWeb = async (url: string) => {
    place('');
    const itemId = uuidv4();
    updateDraft(draftKey, (draft) => ({ ...draft, files: [...draft.files, { type: 'text', id: null, url, name: url, status: 'uploading', itemId }] }));
    try {
      patchFile(draftKey, itemId, { ...(await attachWebAddress(client, url)), itemId });
    } catch (error) {
      removeFile(draftKey, itemId);
      toast(`Couldn't attach that page: ${describeError(error)}`, 'error');
    }
  };

  const entries: MenuEntry[] = [];
  if (trigger?.char === '/') {
    const commands = [
      { id: 'model', title: 'Model', subtitle: 'Choose the model', run: onPickModel },
      { id: 'settings', title: 'Settings', subtitle: 'Open your settings', run: () => router.push('/settings') },
      ...(onTemporary ? [{ id: 'temporary', title: 'Temporary', subtitle: 'Turn temporary chat on or off', run: onTemporary }] : []),
      ...(onFork ? [{ id: 'fork', title: 'Fork', subtitle: 'Carry on in a copy of this chat', run: onFork }] : []),
    ].filter((command) => command.id.startsWith(query.toLowerCase()));
    for (const command of commands) {
      entries.push({
        key: `c-${command.id}`,
        section: 'Commands',
        icon: command.id === 'model' ? 'cpu-chip' : command.id === 'settings' ? 'cog-6-tooth' : command.id === 'fork' ? 'rectangle-stack' : 'eye-slash',
        title: `/${command.id}`,
        subtitle: command.subtitle,
        onPick: () => {
          place('');
          command.run();
        },
      });
    }
    for (const prompt of matchPrompts(prompts.data ?? [], query)) {
      entries.push({ key: `p-${prompt.command}`, section: 'Prompts', icon: 'chat-bubble-bottom-center-text', title: `/${prompt.command}`, subtitle: prompt.name, onPick: () => void insertPrompt(prompt) });
    }
  } else if (trigger) {
    if (isWebAddress(query)) entries.push({ key: 'web', section: 'Web', icon: 'globe-alt', title: 'Attach this page', subtitle: query, onPick: () => void attachWeb(query) });
    if (trigger.char === '@') {
      for (const folder of (folders.data ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5)) {
        entries.push({
          key: `f-${folder.id}`,
          section: 'Folders',
          icon: 'folder',
          title: folder.name,
          onPick: () => {
            place('');
            addAttachment(draftKey, { kind: 'folder', id: folder.id, name: folder.name, description: '', raw: folder as unknown as Record<string, unknown> });
          },
        });
      }
    }
    for (const item of (knowledge.data ?? []).slice(0, 12)) {
      entries.push({
        key: `k-${item.kind}-${item.id}`,
        section: 'Knowledge',
        icon: item.kind === 'collection' ? 'circle-stack' : 'document-text',
        title: item.name,
        subtitle: item.description || (item.kind === 'collection' ? 'Knowledge base' : 'File'),
        onPick: () => {
          place('');
          addAttachment(draftKey, item);
        },
      });
    }
    if (trigger.char === '@') {
      const wanted = query.toLowerCase();
      const shown = pickerModels(models.data ?? []).filter((model) =>
        [model.name, model.id, ...modelTags(model)].some((value) => String(value ?? '').toLowerCase().includes(wanted)),
      );
      for (const model of shown.slice(0, 12)) {
        entries.push({
          key: `m-${model.id}`,
          section: 'Talk to a model',
          icon: 'sparkles',
          title: model.name ?? model.id,
          subtitle: model.id,
          onPick: () => {
            place('');
            updateDraft(draftKey, (draft) => ({ ...draft, atModel: model.id }));
          },
        });
      }
    }
  }

  return {
    trigger,
    entries,
    loading: (trigger?.char === '/' && prompts.isLoading) || ((trigger?.char === '@' || trigger?.char === '#') && knowledge.isFetching),
    empty: trigger?.char === '/' ? 'No commands or prompts match.' : 'Nothing matches. Type a web address to attach a page.',
    form: form?.variables ?? null,
    insertForm: (values: Record<string, string>) => {
      if (!form) return;
      place(applyInputVariables(form.content, values), form.trigger, form.cursor);
      setForm(null);
    },
    cancelForm: () => setForm(null),
  };
}

function addAttachment(draftKey: string, item: Parameters<typeof knowledgeAttachment>[0]) {
  updateDraft(draftKey, (draft) => (draft.files.some((file) => file.id === item.id) ? draft : { ...draft, files: [...draft.files, knowledgeAttachment(item)] }));
}
