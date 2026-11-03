import { describe, expect, it } from 'vitest';
import { DtClient } from './http';
import {
  citedLocators,
  clock,
  collectionOf,
  createCollection,
  highlightRanges,
  imageMarkers,
  importLinks,
  isMedia,
  isPreparing,
  linksIn,
  markdownQuote,
  materialDetailOf,
  passageSelectors,
  readingOfPreferences,
  readingTurnFields,
  saveAnnotation,
  savePosition,
  textBlocks,
  timeOf,
  uploadMaterial,
  videoLinkAt,
  type DtAnnotation,
} from './reading';
import { startTurnCommand } from './turns';

function recordingClient(answer: unknown = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(answer), { status: 200 });
  };
  return { client: new DtClient({ baseUrl: 'https://learn.test', token: 't', fetch }), calls };
}

const annotation = (patch: Partial<DtAnnotation>): DtAnnotation => ({
  id: 'a',
  locator: 1,
  kind: 'highlight',
  color: 'yellow',
  quote: '',
  note: '',
  author: 'user',
  anchor: '',
  rects: [],
  selectors: [],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

describe('reading collections and materials', () => {
  it('reads a collection in its own order, with its open material', () => {
    const collection = collectionOf({
      workspace_id: 'rw_1',
      title: '',
      color: 'teal',
      active_material_id: 'm2',
      tabs: [
        { tab_order: 2, material: { material_id: 'm2', title: 'Notes', source_kind: 'file', status: 'ready', progress: 100 } },
        { tab_order: 1, material: { material_id: 'm1', filename: 'talk.mp4', source_kind: 'video', render_mode: 'video', status: 'processing', progress: 40, duration_seconds: 61.5 } },
      ],
    });
    expect(collection).toMatchObject({ id: 'rw_1', title: 'Untitled collection', color: 'teal', activeMaterialId: 'm2' });
    expect(collection.materials.map((material) => material.id)).toEqual(['m1', 'm2']);
    expect(collection.materials[0]).toMatchObject({ title: 'talk.mp4', duration: 61.5, progress: 40 });
    expect(isPreparing(collection.materials[0]!)).toBe(true);
    expect(isMedia(collection.materials[0]!)).toBe(true);
    expect(isMedia({ kind: 'youtube', renderMode: 'video' })).toBe(true);
    expect(isMedia({ kind: 'file', renderMode: 'pdf' })).toBe(false);
  });

  it('reads a material for the reader', () => {
    const detail = materialDetailOf({
      material_id: 'abc',
      filename: 'x.pdf',
      unit: 'page',
      unit_count: 3,
      render_mode: 'pdf',
      has_raw_view: true,
      revision: 0,
      outline: [{ locator: 2, title: 'Intro', level: 1 }, { locator: 0, title: 'bad' }],
      unit_refs: [{ locator: 1, source_href: '#t=12', title: '0:12' }],
    });
    expect(detail).toMatchObject({ id: 'abc', title: 'x.pdf', unit: 'page', unitCount: 3, hasRawView: true, revision: 1, contentFormat: 'plain_text' });
    expect(detail.outline).toEqual([{ locator: 2, title: 'Intro', level: 1 }]);
    expect(detail.unitRefs).toEqual([{ locator: 1, href: '#t=12', title: '0:12' }]);
  });

  it('finds links in pasted text', () => {
    expect(linksIn('see https://a.example/x and\nhttp://b.example ftp://c https://a.example/x')).toEqual(['https://a.example/x', 'http://b.example']);
  });

  it('talks to the endpoints the reader uses', async () => {
    const { client, calls } = recordingClient({ workspace: { workspace_id: 'rw_1', tabs: [] }, materials: [] });
    await createCollection(client, { title: '  Physics ', color: 'blue' });
    await importLinks(client, ['https://a.example'], { collectionId: 'rw_1' });
    await importLinks(client, ['https://a.example'], { newTitle: 'Reading list' });
    await savePosition(client, 'm/1', { locator: 2.4, anchor: '', percentage: 1.5 });
    await saveAnnotation(client, 'm1', { locator: 2, quote: 'Hello', selectors: passageSelectors('Hello world', 0, 5) });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://learn.test/api/reading/workspaces',
      'POST https://learn.test/api/reading/library/import-urls',
      'POST https://learn.test/api/reading/library/import-urls',
      'PUT https://learn.test/api/reading/materials/m%2F1/position',
      'PUT https://learn.test/api/reading/materials/m1/annotations',
    ]);
    expect(calls[0]?.body).toEqual({ title: 'Physics', color: 'blue' });
    expect(calls[1]?.body).toEqual({ urls: ['https://a.example'], workspace_id: 'rw_1' });
    expect(calls[2]?.body).toEqual({ urls: ['https://a.example'], workspace_title: 'Reading list' });
    expect(calls[3]?.body).toEqual({ locator: 2, source_anchor: '', percentage: 1 });
    expect(calls[4]?.body).toMatchObject({ annotation_id: '', locator: 2, kind: 'highlight', color: 'yellow', quote: 'Hello', rects: [] });
  });

  it('uploads a file as multipart, keeping a separate copy when asked', async () => {
    const { client, calls } = recordingClient({ material_id: 'm9', unit: 'section', unit_count: 1 });
    const detail = await uploadMaterial(client, new Blob(['# Hi'], { type: 'text/markdown' }), 'hi.md', false);
    expect(detail.id).toBe('m9');
    expect(calls[0]?.url).toBe('https://learn.test/api/reading/materials?reuse=false');
    expect(calls[0]?.body).toBeInstanceOf(FormData);
  });
});

describe('the reader’s text', () => {
  it('cuts a unit into paragraphs with their places, keeping fences and maths whole', () => {
    const unit = '  First para\nstill first.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n$$\nx = 1\n\ny = 2\n$$\n\nLast.';
    const blocks = textBlocks(unit);
    expect(blocks.map((block) => block.text)).toEqual(['First para\nstill first.', '```js\nconst a = 1;\n\nconst b = 2;\n```', '$$\nx = 1\n\ny = 2\n$$', 'Last.']);
    for (const block of blocks) expect(unit.slice(block.start, block.end)).toBe(block.text);
  });

  it('builds the selectors DeepTutor checks a passage by', () => {
    const unit = 'Alpha beta gamma.';
    expect(passageSelectors(unit, 6, 10)).toEqual([
      { type: 'TextQuoteSelector', exact: 'beta', prefix: 'Alpha ', suffix: ' gamma.' },
      { type: 'TextPositionSelector', start: 6, end: 10 },
    ]);
  });

  it('places highlights by position, else by quote', () => {
    const unit = 'One two three two.';
    const ranges = highlightRanges(unit, [
      annotation({ id: 'p', quote: 'two', selectors: [{ type: 'TextPositionSelector', start: 14, end: 17 }] }),
      annotation({ id: 'q', quote: 'One' }),
      annotation({ id: 'moved', quote: 'three', selectors: [{ type: 'TextPositionSelector', start: 0, end: 5 }] }),
      annotation({ id: 'gone', quote: 'four' }),
    ]);
    expect(ranges.map((range) => [range.annotation.id, range.start, range.end])).toEqual([
      ['q', 0, 3],
      ['moved', 8, 13],
      ['p', 14, 17],
    ]);
  });

  it('quotes a Markdown paragraph as it reads', () => {
    expect(markdownQuote('## The **light** reactions')).toBe('The light reactions');
    expect(markdownQuote('- See [the notes](https://x.example) and `code`\n- *Second* item')).toBe('See the notes and code\nSecond item');
    expect(markdownQuote('> A quote with ![a figure](img.png)')).toBe('A quote with a figure');
  });

  it('picks out image markers', () => {
    expect(imageMarkers('Text [图片 1: img_1.png] more')).toEqual([
      { type: 'text', text: 'Text ' },
      { type: 'image', name: 'img_1.png' },
      { type: 'text', text: ' more' },
    ]);
  });

  it('reads the pages a reply cites', () => {
    expect(citedLocators('See [p.3] and [p. 5, 7] then [p.9–11] `[p.2]`\n```\n[p.40]\n```')).toEqual([3, 5, 7, 9, 10, 11, 2]);
  });

  it('formats and reads times', () => {
    expect(clock(75)).toBe('1:15');
    expect(clock(3725)).toBe('1:02:05');
    expect(timeOf('#t=12.5')).toBe(12.5);
    expect(timeOf('chapter2.xhtml')).toBeNull();
    expect(videoLinkAt('https://youtu.be/abc?t=0', 90.7)).toBe('https://youtu.be/abc?t=90');
  });
});

describe('reading chats', () => {
  it('sends the collection, material and place with each message', () => {
    const command = startTurnCommand({
      content: 'Explain this passage.',
      sessionId: 's1',
      ...readingTurnFields({ collectionId: 'rw_1', materialId: 'm1', revision: 2, viewport: { locator: 4, selection: '  a passage ' }, linkedChats: ['s0'] }),
    });
    expect(command).toMatchObject({
      capability: 'chat',
      workspace_mode: 'immersive_reading',
      reading_workspace_id: 'rw_1',
      reading_material_id: 'm1',
      reading_material_revision: 2,
      reading_viewport: { locator: 4, selection: 'a passage' },
      history_references: ['s0'],
    });
    const bare = startTurnCommand({ content: 'Hi', ...readingTurnFields({ collectionId: 'rw_1' }) });
    expect(bare.reading_viewport).toBeUndefined();
    expect(bare.reading_material_id).toBeUndefined();
  });

  it('knows a reading chat from its preferences', () => {
    expect(readingOfPreferences({ workspace_mode: 'immersive_reading', reading_workspace_id: 'rw_1', reading_material_id: 'm1' })).toEqual({ collectionId: 'rw_1', materialId: 'm1' });
    expect(readingOfPreferences({ workspace_mode: 'mastery_path' })).toBeNull();
  });
});
