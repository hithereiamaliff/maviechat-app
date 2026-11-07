import { describe, expect, it, vi } from 'vitest';
import { choiceRequest, closeDialog, currentDialog, openDialog, promptRequest, sheetRequest, subscribeDialogs } from './dialogQueue';

describe('text prompts on Android', () => {
  it('gives a callback Cancel and OK, and passes the text to it on OK', () => {
    const callback = vi.fn();
    const request = promptRequest('Rename Session', undefined, callback, 'plain-text', 'Old title');
    expect(request.buttons.map((button) => button.text)).toEqual(['Cancel', 'OK']);
    expect(request.cancel?.text).toBe('Cancel');
    expect(request.submit?.text).toBe('OK');
    request.submit?.onPress?.('New title');
    expect(callback).toHaveBeenCalledWith('New title');
    expect(request).toMatchObject({ title: 'Rename Session', message: null, defaultValue: 'Old title', secure: false, keyboardType: null });
  });

  it('shows the cancel button first, and the return key presses the last of the others', () => {
    const save = vi.fn();
    const request = promptRequest('Rename chat', 'A message', [
      { text: 'Generate', onPress: vi.fn() },
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', onPress: save },
      { text: '' },
    ]);
    expect(request.buttons.map((button) => button.text)).toEqual(['Cancel', 'Generate', 'Save']);
    expect(request.cancel?.text).toBe('Cancel');
    expect(request.submit?.onPress).toBe(save);
    expect(request.message).toBe('A message');
  });

  it('has no cancel to press when no button is one, and plain defaults when none are given', () => {
    const only = promptRequest('Note', null, [{ text: 'Save' }]);
    expect(only.cancel).toBeNull();
    expect(only.submit?.text).toBe('Save');
    expect(promptRequest(null).buttons.map((button) => button.text)).toEqual(['Cancel', 'OK']);
    expect(promptRequest('New password', 'At least 8 characters.', () => undefined, 'secure-text').secure).toBe(true);
  });
});

describe('action sheets on Android', () => {
  it('lists every option but the cancel one, which going back or tapping outside picks', () => {
    const onPick = vi.fn();
    const request = sheetRequest(
      { title: 'Report', message: 'It failed.', options: ['Try Again', 'Remove', 'Delete', 'Cancel'], cancelButtonIndex: 3, destructiveButtonIndex: 2, disabledButtonIndices: [0] },
      onPick,
    );
    expect(request.rows).toEqual([
      { index: 0, label: 'Try Again', destructive: false, disabled: true },
      { index: 1, label: 'Remove', destructive: false, disabled: false },
      { index: 2, label: 'Delete', destructive: true, disabled: false },
    ]);
    expect(request.cancel).toEqual({ index: 3, label: 'Cancel' });
    expect(request).toMatchObject({ title: 'Report', message: 'It failed.' });
    request.onPick(1);
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('takes several destructive options, and works without a cancel option', () => {
    const request = sheetRequest({ options: ['A', 'B', 'C'], destructiveButtonIndex: [0, 2] }, vi.fn());
    expect(request.rows.filter((row) => row.destructive).map((row) => row.label)).toEqual(['A', 'C']);
    expect(request.cancel).toBeNull();
    expect(request.title).toBeNull();
  });
});

describe('alerts with more than three buttons on Android', () => {
  it('become a sheet whose choices press the buttons, with Cancel kept apart', () => {
    const following = vi.fn();
    const cancel = vi.fn();
    const request = choiceRequest('Delete a repeating event', 'Which dates should go?', [
      { text: 'This Event', style: 'destructive', onPress: vi.fn() },
      { text: 'This and Following', style: 'destructive', onPress: following },
      { text: 'All Events', style: 'destructive', onPress: vi.fn() },
      { text: 'Cancel', style: 'cancel', onPress: cancel },
    ]);
    expect(request.rows.map((row) => [row.label, row.destructive])).toEqual([
      ['This Event', true],
      ['This and Following', true],
      ['All Events', true],
    ]);
    expect(request.cancel).toEqual({ index: 3, label: 'Cancel' });
    request.onPick(1);
    expect(following).toHaveBeenCalledOnce();
    request.onPick(3);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('the dialog queue', () => {
  it('shows one dialog at a time, in order, and tells the host when it changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDialogs(listener);
    openDialog(promptRequest('First'));
    openDialog(sheetRequest({ options: ['Second'] }, vi.fn()));
    const first = currentDialog();
    expect(first?.kind).toBe('prompt');
    closeDialog(first!.id);
    const second = currentDialog();
    expect(second?.kind).toBe('sheet');
    expect(second?.id).not.toBe(first?.id);
    closeDialog(second!.id);
    expect(currentDialog()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    openDialog(promptRequest('Unheard'));
    expect(listener).toHaveBeenCalledTimes(4);
    closeDialog(currentDialog()!.id);
  });
});
