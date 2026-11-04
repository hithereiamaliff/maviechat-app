/**
 * How the app's chat code copes with a long chat (M5): a made-up 500-message chat (with side
 * branches) through what opening and streaming do: reading the saved chat, finding the branch
 * shown, lexing every reply's Markdown, and re-lexing a reply as it streams in. Node's numbers;
 * Hermes on an iPhone runs these several times slower, so the budget leaves room for that.
 *
 *   npm run bench:chat
 */
import { IncrementalLexer, lexMarkdown } from '@maviechat/owui-markdown';
import { branchPath, type ChatHistory, type HistoryMessage } from '@maviechat/owui-protocol';

const REPLY = (n: number) => `## Step ${n}

Here is what changes, with **bold**, _italics_, \`code\` and a link to [the docs](https://example.com/${n}).

1. First, read the input.
2. Then, check the edge cases: empty lists, \`null\`, and very long strings.
3. Finally, write the result.

| Case | Input | Output |
| --- | --- | --- |
| empty | \`[]\` | \`0\` |
| one | \`[${n}]\` | \`${n}\` |

\`\`\`ts
export function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0); // ${n}
}
\`\`\`

The sum of the first $n$ numbers is $$\\frac{n(n+1)}{2}$$ and that's all.[1]
`;

function makeHistory(pairs: number): ChatHistory {
  const messages: Record<string, HistoryMessage> = {};
  let parent: string | null = null;
  for (let i = 0; i < pairs; i += 1) {
    const userId = `u${i}`;
    const replyId = `a${i}`;
    messages[userId] = { id: userId, parentId: parent, childrenIds: [replyId], role: 'user', content: `Question ${i}: how do I total a list?`, timestamp: i } as HistoryMessage;
    messages[replyId] = { id: replyId, parentId: userId, childrenIds: [], role: 'assistant', content: REPLY(i), timestamp: i } as HistoryMessage;
    if (parent) messages[parent]?.childrenIds.push(userId);
    // Every tenth answer has a regenerated sibling: a side branch the shown path skips.
    if (i % 10 === 0) {
      const sibling = `a${i}b`;
      messages[sibling] = { id: sibling, parentId: userId, childrenIds: [], role: 'assistant', content: REPLY(i + 1000), timestamp: i } as HistoryMessage;
      messages[userId]?.childrenIds.push(sibling);
    }
    parent = replyId;
  }
  return { messages, currentId: parent };
}

function time(label: string, runs: number, work: () => void): number {
  work();
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    work();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] ?? 0;
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? median;
  console.log(`${label.padEnd(58)} median ${median.toFixed(2)} ms   p95 ${p95.toFixed(2)} ms`);
  return median;
}

const history = makeHistory(250);
const json = JSON.stringify({ chat: { history } });
console.log(`A chat of ${Object.keys(history.messages).length} messages (${(json.length / 1024).toFixed(0)} KB as the server sends it).\n`);

const results = {
  parse: time('read the saved chat (JSON.parse)', 20, () => JSON.parse(json)),
  branch: time('find the branch shown (branchPath)', 50, () => branchPath(history)),
  lexAll: time('lex every reply on the branch (cold, no cache)', 5, () => {
    for (const message of branchPath(history)) if (message.role === 'assistant') lexMarkdown(message.content);
  }),
};

// Streaming: a long reply arriving in 400 pieces, re-lexed after each one.
const long = Array.from({ length: 4 }, (_, i) => REPLY(i)).join('\n');
const pieces = Array.from({ length: 400 }, (_, i) => long.slice(0, Math.ceil(((i + 1) / 400) * long.length)));
const lexer = new IncrementalLexer();
const perPiece: number[] = [];
for (const text of pieces) {
  const started = performance.now();
  lexer.lex(text);
  perPiece.push(performance.now() - started);
}
perPiece.sort((a, b) => a - b);
const streamMedian = perPiece[Math.floor(perPiece.length / 2)] ?? 0;
const streamP95 = perPiece[Math.floor(perPiece.length * 0.95)] ?? 0;
console.log(`${'re-lex a streaming reply per update (incremental)'.padEnd(58)} median ${streamMedian.toFixed(3)} ms   p95 ${streamP95.toFixed(3)} ms`);

// Budgets in Node for a 60 fps phone (16 ms a frame) with Hermes ~5x slower: per-update work
// must stay well under a frame; opening a chat is a one-off and gets more room.
const failures = [
  results.branch > 2 ? 'finding the branch' : '',
  streamP95 > 1 ? 'a streaming update' : '',
  results.parse + results.branch + results.lexAll > 150 ? 'opening the chat (cold)' : '',
].filter(Boolean);
console.log(failures.length ? `\nOver budget: ${failures.join(', ')}.` : '\nWithin budget for a 500-message chat.');
process.exit(failures.length ? 1 : 0);
