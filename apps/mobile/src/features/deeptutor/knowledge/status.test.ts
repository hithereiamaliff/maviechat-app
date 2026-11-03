import { describe, expect, it } from 'vitest';
import { documentCount, engineName, fileSize, kbBusy, kbStatus } from './status';

const progress = (stage: string, percent: number, fileName = '', message = '') => ({ stage, percent, current: 0, total: 1, fileName, message });

describe('knowledge base status', () => {
  it('is busy only while DeepTutor builds or indexes it', () => {
    expect(['initializing', 'processing'].map(kbBusy)).toEqual([true, true]);
    expect(['ready', 'error', 'needs_reindex', 'unavailable', ''].map(kbBusy)).toEqual([false, false, false, false, false]);
  });

  it('says how far indexing is, or what went wrong', () => {
    expect(kbStatus({ status: 'processing', needsReindex: false, progress: null }, progress('processing_file', 45.4, 'notes.pdf'))).toEqual({ label: 'Indexing 45% · notes.pdf', tone: 'busy' });
    expect(kbStatus({ status: 'initializing', needsReindex: false, progress: null })).toEqual({ label: 'Indexing', tone: 'busy' });
    expect(kbStatus({ status: 'error', needsReindex: false, progress: progress('error', 0, '', 'Parser failed') })).toEqual({ label: 'Indexing failed', tone: 'problem', detail: 'Parser failed' });
    expect(kbStatus({ status: 'ready', needsReindex: true, progress: null }).label).toBe('Needs re-indexing');
    // A finished run's progress (100%) doesn't make a ready one look busy.
    expect(kbStatus({ status: 'ready', needsReindex: false, progress: progress('completed', 100) })).toEqual({ label: 'Ready', tone: 'normal' });
    expect(kbStatus({ status: 'some_new_state', needsReindex: false, progress: null }).label).toBe('Some new state');
  });

  it('words counts, engines and sizes', () => {
    expect([documentCount(1), documentCount(3)]).toEqual(['1 document', '3 documents']);
    const providers = [{ id: 'pageindex-oss', name: 'PageIndex OSS', description: '', configured: true, needsSetup: false }];
    expect([engineName('pageindex-oss', providers), engineName('llamaindex', providers)]).toEqual(['PageIndex OSS', 'llamaindex']);
    expect([fileSize(0), fileSize(300), fileSize(5 * 1024 * 1024)]).toEqual(['', '1 KB', '5.0 MB']);
  });
});
