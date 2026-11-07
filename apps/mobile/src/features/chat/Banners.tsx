import { getBanners, type Banner, type BannerType } from '@maviechat/owui-protocol';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useAuthed } from '@/lib/server';
import { Markdown } from '@/markdown/Markdown';
import { fonts, radius, usePalette, type Palette } from '@/theme';

/*
 * The admin's banners, above a new chat as on the web. One you close that the admin made
 * dismissible stays closed on this device (the web keeps that per browser); the others come
 * back next time.
 */

const KEY = 'maviechat.owui.banners';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let dismissed: Record<string, string[]> = {};
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

function parse(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([account, ids]) => (Array.isArray(ids) ? [[account, ids.filter((id): id is string => typeof id === 'string')]] : [])),
    );
  } catch {
    return {};
  }
}

void SecureStore.getItemAsync(KEY, options)
  .then((raw) => {
    const saved = parse(raw);
    for (const [account, ids] of Object.entries(dismissed)) saved[account] = [...new Set([...(saved[account] ?? []), ...ids])];
    dismissed = saved;
    emit();
  })
  .catch(() => undefined);

const NONE: string[] = [];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps a banner closed for good; ids of banners the server no longer has are let go, as on the web. */
function dismiss(account: string, id: string, current: Banner[]) {
  const live = new Set(current.map((banner) => banner.id));
  dismissed = { ...dismissed, [account]: [id, ...(dismissed[account] ?? []).filter((item) => item !== id && live.has(item))] };
  emit();
  void SecureStore.setItemAsync(KEY, JSON.stringify(dismissed), options).catch(() => undefined);
}

const TYPE_LABELS: Record<BannerType, string> = { info: 'Info', warning: 'Warning', error: 'Error', success: 'Success' };
const typeColor = (palette: Palette, type: BannerType) => ({ info: palette.link, warning: palette.warning, error: palette.danger, success: palette.success })[type];

export function Banners() {
  const palette = usePalette();
  const { client, session } = useAuthed();
  const account = `${session.baseUrl}#${session.user.id}`;
  const banners = useQuery({ queryKey: ['banners'], queryFn: () => getBanners(client), staleTime: 5 * 60_000 });
  const gone = useSyncExternalStore(subscribe, () => dismissed[account] ?? NONE);
  // Closed for now: banners the admin didn't make dismissible.
  const [closed, setClosed] = useState<string[]>([]);
  const shown = (banners.data ?? []).filter((banner) => !gone.includes(banner.id) && !closed.includes(banner.id));
  if (!shown.length) return null;

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} nestedScrollEnabled>
      {shown.map((banner) => (
        <View key={banner.id} style={[styles.banner, { borderColor: palette.border, backgroundColor: palette.surface }]} accessibilityRole="summary">
          <View style={styles.body}>
            <View style={styles.heading}>
              <Text style={[styles.type, { color: typeColor(palette, banner.type) }]}>{TYPE_LABELS[banner.type]}</Text>
              {banner.title ? (
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                  {banner.title}
                </Text>
              ) : null}
            </View>
            {banner.content ? <Markdown text={banner.content.replace(/\n/g, '  \n')} muted baseUrl={session.baseUrl} token={session.token} /> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Banner"
            hitSlop={8}
            onPress={() => (banner.dismissible ? dismiss(account, banner.id, banners.data ?? []) : setClosed([...closed, banner.id]))}>
            <Icon name="x-mark" size={16} color={palette.textMuted} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // As on the web's phone layout: a few lines tall at most, scrolling when there are more.
  list: { flexGrow: 0, maxHeight: 132 },
  listContent: { paddingHorizontal: 12, paddingTop: 4, gap: 6 },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  body: { flex: 1, gap: 2 },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  type: { fontFamily: fonts.semibold, fontSize: 12, textTransform: 'uppercase' },
  title: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14 },
});
