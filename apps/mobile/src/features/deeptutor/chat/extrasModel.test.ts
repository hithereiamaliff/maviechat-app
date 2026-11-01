import { describe, expect, it } from 'vitest';
import { extrasRequest, hasExtras, NO_EXTRAS, promptExtras, type DtExtras } from './extrasModel';

const extras: DtExtras = {
  attachments: [
    { id: '1', type: 'image', filename: 'red.png', mimeType: 'image/png', size: 69, base64: 'AAAA', preview: 'data:image/png;base64,AAAA' },
    { id: '2', type: 'file', filename: 'note.txt', mimeType: 'text/plain', size: 27, base64: 'BBBB', preview: null },
  ],
  notebooks: [{ id: 'nb1', name: 'Physics' }],
  chats: [{ id: 'unified_1', title: 'Earlier' }],
};

describe('what goes with a DeepTutor message', () => {
  it('sends attachments inline and references by id', () => {
    expect(extrasRequest(extras)).toEqual({
      attachments: [
        { type: 'image', filename: 'red.png', base64: 'AAAA', mime_type: 'image/png' },
        { type: 'file', filename: 'note.txt', base64: 'BBBB', mime_type: 'text/plain' },
      ],
      notebookReferences: [{ notebook_id: 'nb1' }],
      historyReferences: ['unified_1'],
    });
    expect(hasExtras(NO_EXTRAS)).toBe(false);
    expect(hasExtras(extras)).toBe(true);
  });

  it('shows them under your message until the session has it', () => {
    expect(promptExtras(extras, ['optics'])).toEqual({
      attachments: [
        { key: '1', type: 'image', filename: 'red.png', uri: 'data:image/png;base64,AAAA' },
        { key: '2', type: 'file', filename: 'note.txt', uri: null },
      ],
      references: [
        { key: 'nnb1', kind: 'notebook', label: 'Physics' },
        { key: 'cunified_1', kind: 'chat', label: 'Earlier' },
        { key: 'koptics', kind: 'knowledge', label: 'optics' },
      ],
    });
    expect(promptExtras(NO_EXTRAS)).toBeUndefined();
  });
});
