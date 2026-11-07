import { describe, expect, it } from 'vitest';
import { savedTemporaryChat } from './chats';
import { chatReferenceItem, fitWithin, imageLimits, previousFileItem } from './files';
import type { ChatHistory } from './history';

describe('attaching what is already on the server', () => {
  it('attaches one of your files as an upload would, and references a chat by id', () => {
    expect(previousFileItem({ id: 'f1', filename: 'report.pdf', size: 2048, contentType: 'application/pdf', created_at: 1, userId: 'u' }, 'i1')).toEqual({
      type: 'file',
      id: 'f1',
      url: 'f1',
      name: 'report.pdf',
      collection_name: '',
      status: 'processed',
      size: 2048,
      error: '',
      itemId: 'i1',
      content_type: 'application/pdf',
    });
    expect(previousFileItem({ id: 'f2', filename: 'x', size: null, contentType: null, created_at: 1, userId: 'u' }, 'i2')).not.toHaveProperty('content_type');
    expect(chatReferenceItem({ id: 'c1', title: '' }, 'i3')).toEqual({ type: 'chat', id: 'c1', url: '', name: 'New Chat', status: 'processed', itemId: 'i3' });
  });
});

describe('photo size limits', () => {
  it('uses your size when compression is on, capped by the admin’s', () => {
    expect(imageLimits({}, {})).toBeNull();
    expect(imageLimits({ imageCompression: true, imageCompressionSize: { width: 1600, height: null } }, {})).toEqual({ width: 1600, height: null });
    expect(imageLimits({ imageCompression: true, imageCompressionSize: { width: 4000, height: 3000 } }, { file: { image_compression: { width: 2048, height: null } } })).toEqual({ width: 2048, height: 3000 });
    expect(imageLimits({ imageCompression: false, imageCompressionSize: { width: 100 } }, { file: { image_compression: { width: null, height: 1024 } } })).toEqual({ width: null, height: 1024 });
  });

  it('shrinks to fit keeping the shape, and leaves a photo that fits', () => {
    expect(fitWithin(4000, 3000, { width: 2000, height: null })).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, { width: 2000, height: 2000 })).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(800, 600, { width: 2000, height: 2000 })).toBeNull();
  });
});

describe('saving a temporary chat', () => {
  it('names it after your first message and keeps the whole history', () => {
    const history: ChatHistory = {
      currentId: 'r',
      messages: {
        u: { id: 'u', parentId: null, childrenIds: ['r'], role: 'user', content: 'x'.repeat(60), timestamp: 1 },
        r: { id: 'r', parentId: 'u', childrenIds: [], role: 'assistant', content: 'ok', timestamp: 2 },
      },
    };
    const saved = savedTemporaryChat(history, { models: ['gpt'] }, 99);
    expect(saved.title).toBe(`${'x'.repeat(50)}...`);
    expect(saved).toMatchObject({ models: ['gpt'], params: {}, history, tags: [], timestamp: 99 });
    expect((saved.messages as { id: string }[]).map((message) => message.id)).toEqual(['u', 'r']);
    expect(savedTemporaryChat({ currentId: null, messages: {} }, { models: [] }, 1).title).toBe('New Chat');
  });
});
