import type { DtListItem } from './DtMessageList';

/** A message that contains what you looked for, with a little text around it. */
export interface Match {
  key: string;
  who: string;
  before: string;
  hit: string;
  after: string;
}

/** Where `query` appears in the chat: each message once, with a little of the text around it. */
export function findInChat(items: DtListItem[], query: string): Match[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return items.flatMap((item): Match[] => {
    const text = (item.kind === 'user' ? item.text : item.reply.answer).replace(/\s+/g, ' ');
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) return [];
    const start = Math.max(0, at - 40);
    return [
      {
        key: item.key,
        who: item.kind === 'user' ? 'You' : 'DeepTutor',
        before: `${start > 0 ? '…' : ''}${text.slice(start, at)}`,
        hit: text.slice(at, at + needle.length),
        after: `${text.slice(at + needle.length, at + needle.length + 80)}${at + needle.length + 80 < text.length ? '…' : ''}`,
      },
    ];
  });
}
