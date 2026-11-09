import {
  applyInputVariables,
  fillBuiltinVariables,
  inputVariables,
  isWebAddress,
  knowledgeAttachment,
  listFolders,
  listSkillChoices,
  matchPrompts,
  menuTrigger,
  modelTags,
  pickerModels,
  replaceTrigger,
  skillMention,
  type InputVariable,
  type MenuTrigger,
  type SavedPrompt,
} from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { emojiForShortName, emojiOfName } from '@/lib/emoji';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useKnowledgeSearch, useModels, usePrompts, useSessionUser, useUserSettings } from '@/lib/server';
import { attachPageToDraft } from './attachPage';
import { getDraft, updateDraft } from './drafts';
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
  /** A saved chat's `/compact`, where the admin turned context compaction on. */
  onCompact?: () => void;
  /** `/status`: what the chat uses and has running, once it has messages. */
  onStatus?: () => void;
  /** `/compare`: the message so far beside a revision you paste (0.12's comparison). */
  onCompare?: () => void;
}

/**
 * The input's menus, as on the web: `/` for commands, your saved prompts (built-in variables
 * filled in, your own asked for in a form) and skills (put in the message as the web puts them,
 * for the server to add); `$` for skills alone; `@` for a model to talk to, knowledge, folders and
 * web pages; `#` for knowledge and web pages; `:` for an emoji by its name (`:smile`).
 */
export function useInputMenus({ draftKey, text, cursor, focused, setText, onPickModel, onTemporary, onFork, onCompact, onStatus, onCompare }: Options) {
  const { client } = useAuthed();
  const toast = useToast();
  const capabilities = useCapabilities();
  const settings = useUserSettings();
  const user = useSessionUser();
  const trigger = focused ? menuTrigger(text, cursor) : null;
  const query = trigger?.query ?? '';
  const prompts = usePrompts(trigger?.char === '/');
  const skills = useQuery({
    queryKey: ['workspace', 'skill-choices'],
    queryFn: () => listSkillChoices(client),
    enabled: trigger?.char === '/' || trigger?.char === '$',
    staleTime: 60_000,
  });
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
    await attachPageToDraft(client, draftKey, url).catch((error: unknown) => toast(`Couldn't attach that page: ${describeError(error)}`, 'error'));
  };

  const entries: MenuEntry[] = [];
  const wanted = query.toLowerCase();
  const skillEntries = (): MenuEntry[] =>
    (skills.data ?? [])
      .filter((item) => item.active && (item.name.toLowerCase().includes(wanted) || item.id.toLowerCase().includes(wanted)))
      .slice(0, 8)
      .map((skill) => ({ key: `s-${skill.id}`, section: 'Skills', icon: 'sparkles', title: skill.name, subtitle: skill.description || 'Skill', onPick: () => place(`${skillMention(skill)} `) }));
  if (trigger?.char === '$') {
    entries.push(...skillEntries());
  } else if (trigger?.char === ':') {
    // As on the web: the emoji itself takes the place of `:name`.
    for (const emoji of emojiForShortName(query)) {
      entries.push({ key: `e-${emoji.code}`, section: 'Emoji', icon: 'face-smile', glyph: emoji.char, title: `:${emoji.names[0]}:`, onPick: () => place(emoji.char) });
    }
  } else if (trigger?.char === '/') {
    const commands = [
      { id: 'model', title: 'Model', subtitle: 'Choose the model', run: onPickModel },
      { id: 'settings', title: 'Settings', subtitle: 'Open your settings', run: () => router.push('/settings') },
      ...(onTemporary ? [{ id: 'temporary', title: 'Temporary', subtitle: 'Turn temporary chat on or off', run: onTemporary }] : []),
      ...(onCompact ? [{ id: 'compact', title: 'Compact', subtitle: 'Summarise the chat so far, to make room', run: onCompact }] : []),
      ...(onFork ? [{ id: 'fork', title: 'Fork', subtitle: 'Carry on in a copy of this chat', run: onFork }] : []),
      ...(onStatus ? [{ id: 'status', title: 'Status', subtitle: 'What this chat uses and has running', run: onStatus }] : []),
      ...(onCompare ? [{ id: 'compare', title: 'Compare', subtitle: 'Your message beside a revision you paste', run: onCompare }] : []),
    ].filter((command) => command.id.startsWith(query.toLowerCase()));
    for (const command of commands) {
      entries.push({
        key: `c-${command.id}`,
        section: 'Commands',
        icon:
          command.id === 'model'
            ? 'cpu-chip'
            : command.id === 'settings'
              ? 'cog-6-tooth'
              : command.id === 'fork'
                ? 'rectangle-stack'
                : command.id === 'compact'
                  ? 'bars-arrow-up'
                  : command.id === 'status'
                    ? 'information-circle'
                    : command.id === 'compare'
                      ? 'arrows-right-left'
                      : 'eye-slash',
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
    entries.push(...skillEntries());
  } else if (trigger) {
    if (isWebAddress(query)) entries.push({ key: 'web', section: 'Web', icon: 'globe-alt', title: 'Attach this page', subtitle: query, onPick: () => void attachWeb(query) });
    if (trigger.char === '@') {
      for (const folder of (folders.data ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5)) {
        entries.push({
          key: `f-${folder.id}`,
          section: 'Folders',
          icon: 'folder',
          glyph: typeof folder.meta?.icon === 'string' && folder.meta.icon ? emojiOfName(folder.meta.icon) : undefined,
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

  const loading = (trigger?.char === '/' && prompts.isLoading) || (trigger?.char === '$' && skills.isLoading) || ((trigger?.char === '@' || trigger?.char === '#') && knowledge.isFetching);
  return {
    // `$` is also typed in prices, and `:` in text: their lists show only when something matches.
    trigger: (trigger?.char === '$' || trigger?.char === ':') && entries.length === 0 && !loading ? null : trigger,
    entries,
    loading,
    empty: trigger?.char === '/' ? 'No commands, prompts or skills match.' : trigger?.char === '$' ? 'No skills match.' : 'Nothing matches. Type a web address to attach a page.',
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
