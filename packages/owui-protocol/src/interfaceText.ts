import { getAdminConfig, saveAdminConfig } from './adminSettings';
import type { OwuiClient } from './http';

/*
 * Interface text (Open WebUI 0.12, Admin → General's interface part): the web's own wording
 * replaced, language by language. Each row is a text of the web's (its English words, or its key)
 * and, per language, what to show instead. Placeholders such as {{name}} must stay as they are.
 * The server keeps them in its admin config as `I18N` (language → text → replacement) and sends
 * them to every browser; this app's own words are its own and don't change.
 */

type Tree = Record<string, unknown>;
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Language → the web's text → what to show instead. */
export type InterfaceTextDictionary = Record<string, Record<string, string>>;

/** One of the web's texts and its replacement in each language. */
export interface InterfaceTextRow {
  original: string;
  /** Language code (the web's, such as `en-US`) → replacement. */
  replacements: Record<string, string>;
}

/** The languages the web's interface comes in, by the codes it uses (an override applies under the same code). */
export const WEB_LANGUAGES: readonly string[] = [
  'ar', 'ar-BH', 'az-AZ', 'bg-BG', 'bn-BD', 'bo-TB', 'bs-BA', 'ca-ES', 'ceb-PH', 'cs-CZ', 'da-DK', 'de-DE', 'dg-DG', 'el-GR', 'en-GB', 'en-US',
  'es-ES', 'et-EE', 'eu-ES', 'fa-IR', 'fi-FI', 'fil-PH', 'fo-FO', 'fr-CA', 'fr-FR', 'gl-ES', 'he-IL', 'hi-IN', 'hr-HR', 'hu-HU', 'id-ID', 'ie-GA',
  'it-IT', 'ja-JP', 'kab-DZ', 'ka-GE', 'ko-KR', 'lt-LT', 'lv-LV', 'ms-MY', 'nb-NO', 'nl-NL', 'pa-IN', 'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU',
  'sk-SK', 'sl-SI', 'sr-RS', 'sv-SE', 'ta-IN', 'th-TH', 'tk-TM', 'tr-TR', 'ug-CN', 'uk-UA', 'ur-PK', 'uz-Cyrl-UZ', 'uz-Latn-UZ', 'vi-VN', 'zh-CN', 'zh-TW',
];

/** Names the server won't take as a language or a text. */
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

/** The rows a saved dictionary holds (null where the server has none: 0.11), in the order first seen. */
export function interfaceTextOf(config: Tree | null | undefined): InterfaceTextRow[] | null {
  const value = config?.I18N;
  if (value === undefined) return null;
  const rows = new Map<string, InterfaceTextRow>();
  for (const [language, texts] of Object.entries(isTree(value) ? value : {})) {
    for (const [original, replacement] of Object.entries(isTree(texts) ? texts : {})) {
      if (typeof replacement !== 'string') continue;
      const row = rows.get(original) ?? { original, replacements: {} };
      row.replacements[language] = replacement;
      rows.set(original, row);
    }
  }
  return [...rows.values()];
}

/** The placeholders in a text (`{{name}}`, `{{count, number}}`…), by name, as the server reads them. */
export function placeholdersIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{\{\s*-?\s*([^},]+)(?:,[^}]+)?\s*\}\}/g), (match) => (match[1] ?? '').trim()))].sort();
}

/** What's wrong with the rows before they can be saved, in words; null when they're fine. Rows count from 1. */
export function interfaceTextProblem(rows: InterfaceTextRow[]): string | null {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const filled = Object.entries(row.replacements).filter(([, text]) => text.trim());
    if (!row.original.trim()) {
      if (filled.length) return `Row ${index + 1}: write the web’s text it replaces.`;
      continue;
    }
    if (UNSAFE.has(row.original)) return `Row ${index + 1}: the server won’t take that text.`;
    if (seen.has(row.original)) return `Row ${index + 1}: that text is already in the list.`;
    seen.add(row.original);
    const wanted = placeholdersIn(row.original).join();
    for (const [language, text] of filled) {
      if (UNSAFE.has(language) || !language.trim()) return `Row ${index + 1}: “${language}” isn’t a language code.`;
      if (placeholdersIn(text).join() !== wanted) return `Row ${index + 1} (${language}): keep the same placeholders as the original${wanted ? ` (${placeholdersIn(row.original).map((name) => `{{${name}}}`).join(', ')})` : ' (it has none)'}.`;
    }
  }
  return null;
}

/** The rows as the server keeps them: empty replacements, empty rows and languages with nothing left out. */
export function dictionaryOf(rows: InterfaceTextRow[]): InterfaceTextDictionary {
  const dictionary: InterfaceTextDictionary = {};
  for (const row of rows) {
    if (!row.original.trim()) continue;
    for (const [language, text] of Object.entries(row.replacements)) {
      if (text.trim()) dictionary[language] = { ...dictionary[language], [row.original]: text };
    }
  }
  return dictionary;
}

/** Saves the rows over the admin config as it is now (everything else as read); the rows as the server kept them. */
export async function saveInterfaceText(client: OwuiClient, rows: InterfaceTextRow[]): Promise<InterfaceTextRow[]> {
  const problem = interfaceTextProblem(rows);
  if (problem) throw new Error(problem);
  const config = await getAdminConfig(client);
  if (config.I18N === undefined) throw new Error('This server has no interface text settings (Open WebUI 0.12 has them).');
  const saved = await saveAdminConfig(client, { ...config, I18N: dictionaryOf(rows) });
  return interfaceTextOf(saved) ?? interfaceTextOf({ I18N: dictionaryOf(rows) }) ?? [];
}

/** A language's name in the phone's language where it knows it, else its code. */
export function languageName(code: string): string {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'language' });
    const name = names.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}
