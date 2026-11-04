/*
 * Personas and skills are Markdown files that open with a YAML header between `---` lines.
 * DeepTutor keeps settings there (a skill's `always` and `requires`, say), so an editor shows the
 * body and puts it back under the header it came with.
 */

/** A Markdown file split at its header: `header` is the raw header with both `---` lines, or ''. */
export interface DtMarkdownFile {
  header: string;
  body: string;
}

const HEADER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(file: string): DtMarkdownFile {
  const text = file.replace(/^﻿/, '');
  const match = HEADER.exec(text);
  if (!match) return { header: '', body: text };
  return { header: match[0].endsWith('\n') ? match[0] : `${match[0]}\n`, body: text.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '') };
}

/** The file again: the header, a blank line, then the body. */
export function joinFrontMatter({ header, body }: DtMarkdownFile): string {
  if (!header) return body;
  return `${header}\n${body.replace(/^(?:[ \t]*\r?\n)+/, '')}`;
}
