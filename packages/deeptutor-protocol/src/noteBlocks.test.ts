import { describe, expect, it } from 'vitest';
import { blocksFromMarkdown } from './noteBlocks';

const ids = () => {
  let next = 0;
  return () => `b${next++}`;
};

describe('Markdown as Co-Writer blocks', () => {
  it('turns paragraphs and headings, with inline styles and safe links', () => {
    expect(blocksFromMarkdown('## Plants\n\nGreen plants **make _sugar_** from `CO2` & water: [more](https://x.example).', ids())).toEqual([
      { id: 'b0', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Plants', styles: {} }], children: [] },
      {
        id: 'b1',
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'Green plants ', styles: {} },
          { type: 'text', text: 'make ', styles: { bold: true } },
          { type: 'text', text: 'sugar', styles: { bold: true, italic: true } },
          { type: 'text', text: ' from ', styles: {} },
          { type: 'text', text: 'CO2', styles: { code: true } },
          { type: 'text', text: ' & water: ', styles: {} },
          { type: 'link', href: 'https://x.example', content: [{ type: 'text', text: 'more', styles: {} }] },
          { type: 'text', text: '.', styles: {} },
        ],
        children: [],
      },
    ]);
  });

  it('turns lists, nested ones and checklists, quotes, code and rules', () => {
    const blocks = blocksFromMarkdown('- [ ] read\n- [x] write\n  - draft\n\n1. one\n\n> said\n> twice\n\n```py\nprint(1)\n```\n\n---', ids());
    expect(blocks?.map((block) => [block.type, block.props])).toEqual([
      ['checkListItem', { checked: false }],
      ['checkListItem', { checked: true }],
      ['numberedListItem', {}],
      ['quote', {}],
      ['codeBlock', { language: 'py' }],
      ['divider', {}],
    ]);
    expect((blocks?.[1]?.children as { type: string }[])[0]?.type).toBe('bulletListItem');
    expect(blocks?.[3]?.content).toEqual([
      { type: 'text', text: 'said\ntwice', styles: {} },
    ]);
  });

  it('leaves to DeepTutor what it can’t turn safely', () => {
    expect(blocksFromMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBeNull();
    expect(blocksFromMarkdown('![photo](https://x.example/a.png)')).toBeNull();
    expect(blocksFromMarkdown('[bad](javascript:alert(1))')).toBeNull();
    expect(blocksFromMarkdown('<div>raw</div>')).toBeNull();
    expect(blocksFromMarkdown('   ')).toBeNull();
  });
});
