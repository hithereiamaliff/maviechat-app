import { interfaceOn, saveUiSettings, withUiChanges, type InterfaceKey, type UserSettings } from '@maviechat/owui-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useUserSettings } from '@/lib/server';

/** Your Interface settings as the app follows them: what you saved, else the web's defaults. */
export function useInterface(): (key: InterfaceKey) => boolean {
  const settings = useUserSettings();
  const ui = settings.data?.ui;
  return useCallback((key: InterfaceKey) => interfaceOn(ui, key), [ui]);
}

/** Whether this account may change its settings: an admin's policy can forbid every change (the server answers 403). */
export function useCanSaveSettings(): boolean {
  const capabilities = useCapabilities();
  return capabilities ? capabilities.isAdmin || capabilities.can('settings.interface', true) : false;
}

// One save at a time: each reads your settings and writes them all back, so two at once could
// undo each other. The settings are read again once the last one is in.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

/**
 * Saves a few settings (dotted paths): on screen at once, then on the server. Answers false
 * (after a toast) when the server refused.
 */
export function useSaveUiSettings(): (changes: Record<string, unknown>) => Promise<boolean> {
  const { client } = useAuthed();
  const queryClient = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (changes: Record<string, unknown>) => {
      queryClient.setQueryData<UserSettings>(['user-settings'], (old) => ({ ...(old ?? {}), ui: withUiChanges(old?.ui, changes) }));
      pending += 1;
      const run = queue.then(() => saveUiSettings(client, changes));
      queue = run.catch(() => undefined);
      try {
        await run;
        return true;
      } catch (error) {
        toast(`Couldn't save it: ${describeError(error)}`, 'error');
        return false;
      } finally {
        pending -= 1;
        // What the server kept, with your admin's defaults merged in.
        if (pending === 0) void queryClient.invalidateQueries({ queryKey: ['user-settings'] });
      }
    },
    [client, queryClient, toast],
  );
}
