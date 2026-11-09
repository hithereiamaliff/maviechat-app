import { listApps, OwuiHttpError, updateApp, type ServerApp } from '@maviechat/owui-protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { Note } from '@/features/settings/rows';
import { describeError } from '@/lib/errors';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';
import { AppSheet, appState, type AppSheetTarget } from './AppSheet';

const APPS_KEY = ['admin', 'apps'];

/**
 * Admin → Apps (Open WebUI 0.12, marked experimental on the web): outside apps that join
 * channels and answer there. Listed with how each is doing (read again every few seconds, as on
 * the web); Add App; tap one for its settings; switch one off, or on (which connects it).
 */
export function AppsPage() {
  const palette = usePalette();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client } = useAuthed();
  const apps = useQuery({ queryKey: APPS_KEY, queryFn: () => listApps(client), refetchInterval: 5000, retry: false });
  const [sheet, setSheet] = useState<AppSheetTarget | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const off = apps.error instanceof OwuiHttpError && apps.error.status === 404;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: APPS_KEY });

  const switchIt = async (app: ServerApp, on: boolean) => {
    // As on the web: switching one on opens its settings, where saving connects it.
    if (on) return setSheet({ kind: 'edit', app });
    setSwitching(app.id);
    try {
      await updateApp(client, app.id, { off: true });
      refresh();
      toast(`${app.name} is off`);
    } catch (error) {
      toast(`Couldn’t switch it off: ${describeError(error)}`, 'error');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <View style={styles.page}>
      <Note>Outside apps that join channels and answer there (marked experimental on the web). The server connects to each itself, over HTTPS.</Note>
      {off ? <Note>Apps are off on this server: switch them on in General → Features → Apps.</Note> : null}
      {!off ? (
        <View style={styles.start}>
          <Button label="Add App" variant="secondary" onPress={() => setSheet({ kind: 'new' })} />
        </View>
      ) : null}
      {apps.isLoading ? <ActivityIndicator color={palette.textMuted} /> : null}
      {apps.isError && !off ? <Note>{`Couldn’t load them: ${describeError(apps.error)}`}</Note> : null}
      {apps.data && !apps.data.length ? <Note>None yet.</Note> : null}
      {apps.data?.map((app) => (
        <Pressable
          key={app.id}
          accessibilityRole="button"
          accessibilityHint="Opens its settings"
          onPress={() => setSheet({ kind: 'edit', app })}
          style={({ pressed }) => [styles.item, { borderColor: palette.border, opacity: app.active ? 1 : 0.6, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
          {app.manifest.picture && /^(https:|data:image\/)/.test(app.manifest.picture) ? (
            <Image source={{ uri: app.manifest.picture }} style={styles.picture} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <View style={[styles.picture, styles.placeholder, { backgroundColor: palette.surface }]}>
              <Icon name="squares-2x2" size={16} color={palette.textMuted} />
            </View>
          )}
          <View style={styles.text}>
            <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
              {app.name}
            </Text>
            <Text style={[styles.meta, { color: app.active && app.connection === 'connected' ? palette.success : palette.textFaint }]} numberOfLines={1}>
              {`${appState(app)} · @${app.slug}`}
            </Text>
          </View>
          <Switch accessibilityLabel={`${app.name} on`} value={app.active} disabled={switching === app.id} onValueChange={(next) => void switchIt(app, next)} />
        </Pressable>
      ))}
      <AppSheet target={sheet} onClose={() => setSheet(null)} onChanged={refresh} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 10 },
  start: { alignSelf: 'flex-start' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  picture: { width: 34, height: 34, borderRadius: 9 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.regular, fontSize: 11 },
});
