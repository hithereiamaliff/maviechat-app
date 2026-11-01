import { describe, expect, it } from 'vitest';
import type { FileItem } from './files';
import {
  availableToggles,
  combineQueued,
  defaultToggles,
  defaultToolIds,
  effectiveToggles,
  filesPending,
  modelSupports,
  uploadLimitError,
} from './input';
import type { ModelItem } from './models';

const allowAll = { feature: () => true };
const model = (capabilities?: Record<string, boolean>, meta: Record<string, unknown> = {}): ModelItem => ({
  id: 'm',
  name: 'M',
  info: { meta: { ...(capabilities ? { capabilities } : {}), ...meta } },
});

describe('model capabilities', () => {
  it('counts an unlisted capability as supported', () => {
    expect(modelSupports(model(), 'vision')).toBe(true);
    expect(modelSupports(model({ vision: false }), 'vision')).toBe(false);
    expect(modelSupports(undefined, 'file_upload')).toBe(true);
  });

  it('offers a toggle only when the server, the permission and the model allow it', () => {
    const onlyWeb = { feature: (id: string) => id === 'webSearch' || id === 'codeInterpreter' };
    expect(availableToggles(onlyWeb, model({ code_interpreter: false }))).toEqual({
      webSearch: true,
      imageGeneration: false,
      codeInterpreter: false,
    });
  });

  it('drops toggles the current model no longer offers', () => {
    expect(
      effectiveToggles({ webSearch: true, codeInterpreter: true }, { webSearch: false, imageGeneration: true, codeInterpreter: true }),
    ).toEqual({ codeInterpreter: true });
  });
});

describe('defaults', () => {
  it('turns on default features only for capabilities the model lists', () => {
    const m = model({ web_search: true, image_generation: false }, { defaultFeatureIds: ['web_search', 'image_generation', 'code_interpreter'] });
    expect(defaultToggles(allowAll, m)).toEqual({ webSearch: true });
    expect(defaultToggles({ feature: () => false }, m)).toEqual({});
    expect(defaultToggles(allowAll, model({ web_search: true }))).toEqual({});
  });

  it("prefers the model's tools, else the saved ones, keeping only usable tools", () => {
    const tools = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'oauth', name: 'O', authenticated: false },
    ];
    expect(defaultToolIds(model(undefined, { toolIds: ['b', 'gone', 'oauth', 'b'] }), tools, ['a'])).toEqual(['b']);
    expect(defaultToolIds(model(), tools, ['a', 'gone'])).toEqual(['a']);
    expect(defaultToolIds(model(), tools, undefined)).toEqual([]);
  });
});

describe('attachment rules', () => {
  it("applies the server's count and size limits", () => {
    const config = { file: { max_count: 2, max_size: 1 } };
    expect(uploadLimitError(config, 1, [{ size: 10 }, { size: 10 }])).toMatch(/maximum of 2/);
    expect(uploadLimitError(config, 0, [{ size: 2 * 1024 * 1024 }])).toMatch(/1 MB/);
    expect(uploadLimitError(config, 0, [{ size: 0 }])).toMatch(/empty/);
    expect(uploadLimitError({ file: { max_count: null, max_size: null } }, 40, [{ size: 9e9 }])).toBeNull();
    expect(uploadLimitError(undefined, 0, [{ size: undefined }])).toBeNull();
  });

  it('holds messages whose files are uploading or failed', () => {
    const file = (status: FileItem['status']): FileItem => ({ type: 'file', id: null, url: '', name: 'x', status });
    expect(filesPending([file('uploaded')])).toBe(false);
    expect(filesPending([file('uploaded'), file('uploading')])).toBe(true);
    expect(filesPending([file('error')])).toBe(true);
  });
});

describe('message queue', () => {
  it('sends queued messages as one, separated by blank lines', () => {
    const doc: FileItem = { type: 'file', id: 'f', url: 'f', name: 'a.pdf' };
    expect(
      combineQueued([
        { id: '1', prompt: 'First', files: [] },
        { id: '2', prompt: 'Second', files: [doc] },
      ]),
    ).toEqual({ prompt: 'First\n\nSecond', files: [doc] });
  });
});
