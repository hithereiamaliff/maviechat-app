import { markdownToHtml } from '@maviechat/owui-markdown';
import { setStringAsync, StringFormat } from 'expo-clipboard';

/** Copies a reply: its Markdown, or (with "copy with formatting") rich text that pastes as it looks. */
export async function copyReply(markdown: string, formatted: boolean): Promise<void> {
  if (formatted) await setStringAsync(markdownToHtml(markdown), { inputFormat: StringFormat.HTML });
  else await setStringAsync(markdown);
}
