import type { OwuiClient } from './http';
import { getUserSettings, updateUserSettings, type UserSettings } from './models';

/*
 * Your settings as the web app keeps them on the server (`settings.ui`). The app changes a few
 * at a time: it reads them, changes those keys and writes them all back, so the keys it doesn't
 * know (and what another device just saved) survive.
 */

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A setting by its dotted path (`audio.tts.playbackRate`), or undefined. */
export function uiValue(ui: Tree | null | undefined, path: string): unknown {
  let node: unknown = ui ?? {};
  for (const key of path.split('.')) {
    if (!isTree(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * `ui` with each dotted path set (copied on the way down, so nothing shared is changed); a path
 * set to `undefined` is removed, as the web removes a setting put back to its default.
 */
export function withUiChanges(ui: Tree | null | undefined, changes: Record<string, unknown>): Tree {
  const root: Tree = { ...(ui ?? {}) };
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let node = root;
    for (const key of keys) {
      const next = isTree(node[key]) ? { ...(node[key] as Tree) } : {};
      node[key] = next;
      node = next;
    }
    if (value === undefined) delete node[last];
    else node[last] = value;
  }
  return root;
}

/**
 * `ui` as sent: the new values, and null for each top-level key taken away. Open WebUI 0.12
 * saves `ui` key by key (a key left out is kept; null removes it); 0.11 replaces it whole and
 * drops nulls. Either way, a setting taken away goes.
 */
export function uiPatch(before: Tree | null | undefined, after: Tree): Tree {
  const patch: Tree = { ...after };
  for (const key of Object.keys(before ?? {})) if (!(key in after)) patch[key] = null;
  return patch;
}

/** Saves a few of your settings (dotted paths), keeping every other one; answers with what the server kept. */
export async function saveUiSettings(client: OwuiClient, changes: Record<string, unknown>): Promise<UserSettings> {
  const current = await getUserSettings(client);
  return updateUserSettings(client, { ...current, ui: uiPatch(current.ui, withUiChanges(current.ui, changes)) });
}

// ── Interface ────────────────────────────────────────────────────────────────

export type InterfaceGroup = 'UI' | 'Chat' | 'File';

export interface InterfaceSetting {
  /** Where the web keeps it in `settings.ui`. */
  path: string;
  group: InterfaceGroup;
  label: string;
  hint?: string;
  /** The web's default (an admin's defaults come merged into the settings the app reads). */
  default: boolean;
  /** What's stored for on and off, when not `true`/`false`. `null` is "the default". */
  on?: unknown;
  off?: unknown;
  /** Shown only to accounts that may start temporary chats. */
  needsTemporary?: boolean;
}

/**
 * The web app's Interface settings that this app follows, in the web's groups and order. The
 * others are about the browser (text size, fonts, tab titles, keyboard, rich text, sandboxes,
 * call mode) or features the app doesn't have yet.
 */
export const INTERFACE_SETTINGS = {
  landingPageMode: { path: 'landingPageMode', group: 'UI', default: false, on: 'chat', off: '', label: 'New chats open as a chat', hint: 'The message box starts at the bottom, as in a chat, instead of in the middle.' },
  copyFormatted: { path: 'copyFormatted', group: 'UI', default: false, label: 'Copy with formatting', hint: 'Copying a reply keeps its bold, lists and links, instead of giving its Markdown.' },
  enableMessageQueue: { path: 'enableMessageQueue', group: 'Chat', default: true, label: 'Queue messages', hint: 'Send while a reply is being written; your message waits its turn.' },
  temporaryChatByDefault: { path: 'temporaryChatByDefault', group: 'Chat', default: false, label: 'New chats are temporary', needsTemporary: true },
  renderMarkdownInUserMessages: { path: 'renderMarkdownInUserMessages', group: 'Chat', default: true, label: 'Format your messages', hint: 'Show the Markdown in what you send: bold, lists, code.' },
  renderMarkdownInAssistantMessages: { path: 'renderMarkdownInAssistantMessages', group: 'Chat', default: true, label: 'Format replies', hint: 'Off shows replies as plain text.' },
  titleAuto: { path: 'title.auto', group: 'Chat', default: true, label: 'Name chats automatically' },
  autoFollowUps: { path: 'autoFollowUps', group: 'Chat', default: true, label: 'Suggest follow-ups' },
  autoTags: { path: 'autoTags', group: 'Chat', default: true, label: 'Tag chats automatically' },
  responseAutoCopy: { path: 'responseAutoCopy', group: 'Chat', default: false, label: 'Copy each reply when it’s done' },
  scrollOnResponseGeneration: { path: 'scrollOnResponseGeneration', group: 'Chat', default: true, label: 'Follow replies as they’re written' },
  scrollOnBranchChange: { path: 'scrollOnBranchChange', group: 'Chat', default: true, label: 'Bring a message into view when you switch its version' },
  insertSuggestionPrompt: { path: 'insertSuggestionPrompt', group: 'Chat', default: false, label: 'Suggestions fill the message box', hint: 'On a new chat, tapping a suggestion puts it in the box instead of sending it.' },
  keepFollowUpPrompts: { path: 'keepFollowUpPrompts', group: 'Chat', default: false, label: 'Keep follow-ups under earlier replies' },
  insertFollowUpPrompt: { path: 'insertFollowUpPrompt', group: 'Chat', default: false, label: 'Follow-ups fill the message box', hint: 'Tapping a follow-up puts it in the box instead of sending it.' },
  regenerateMenu: { path: 'regenerateMenu', group: 'Chat', default: true, label: 'Regenerate menu', hint: 'Off, Regenerate tries again at once, without Add Details, More Concise and the rest.' },
  collapseCodeBlocks: { path: 'collapseCodeBlocks', group: 'Chat', default: false, label: 'Fold code blocks' },
  expandDetails: { path: 'expandDetails', group: 'Chat', default: false, label: 'Open thinking and tool steps', hint: 'Reasoning, tool calls and searches start opened instead of folded.' },
  displayMultiModelResponsesInTabs: { path: 'displayMultiModelResponsesInTabs', group: 'Chat', default: false, label: 'Several models’ answers as tabs' },
  webSearch: { path: 'webSearch', group: 'Chat', default: false, on: 'always', off: null, label: 'Always search the web', hint: 'Every message searches the web, where the server, your account and the model allow it.' },
  largeTextAsFile: { path: 'largeTextAsFile', group: 'File', default: false, label: 'Paste long text as a file', hint: 'Pasting more than 1,000 characters attaches them as a text file, read in full.' },
  defaultUploadContext: { path: 'defaultUploadContext', group: 'File', default: false, on: 'full', off: 'focused', label: 'Send whole documents', hint: 'Files you attach are read in full, instead of searched for the parts that matter.' },
} as const satisfies Record<string, InterfaceSetting>;

export type InterfaceKey = keyof typeof INTERFACE_SETTINGS;

const stored = (setting: InterfaceSetting, on: boolean): unknown => (on ? ('on' in setting ? setting.on : true) : 'off' in setting ? setting.off : false);

/** Whether an Interface setting is on: what's saved, else the web's default. */
export function interfaceOn(ui: Tree | null | undefined, key: InterfaceKey): boolean {
  const setting: InterfaceSetting = INTERFACE_SETTINGS[key];
  const value = uiValue(ui, setting.path);
  return value === undefined || value === null ? setting.default : value === stored(setting, true);
}

/** The change that turns an Interface setting on or off, for `saveUiSettings`. */
export function interfaceChange(key: InterfaceKey, on: boolean): Record<string, unknown> {
  const setting: InterfaceSetting = INTERFACE_SETTINGS[key];
  return { [setting.path]: stored(setting, on) };
}

// ── Audio ────────────────────────────────────────────────────────────────────

/** Read Aloud's speed (`audio.tts.playbackRate`): 1 is normal, and the default. */
export function speechRate(ui: Tree | null | undefined): number {
  const rate = Number(uiValue(ui, 'audio.tts.playbackRate'));
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** The speeds the app steps through, slowest first. The web takes any number; one set there is kept until you step. */
export const SPEECH_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** The next speed up or down from `rate`, or `rate` itself at either end. */
export function stepSpeechRate(rate: number, direction: 1 | -1): number {
  if (direction > 0) return SPEECH_RATES.find((step) => step > rate + 1e-9) ?? rate;
  return [...SPEECH_RATES].reverse().find((step) => step < rate - 1e-9) ?? rate;
}

/** A speed as the app shows it: "1×", "1.25×". */
export function speechRateLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}
