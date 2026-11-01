import type { SourceRef } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { openLink } from '@/lib/links';
import { fonts, radius, usePalette } from '@/theme';

/** The "N Sources" pill under a response; tap to list them, tap a source to open it. */
export function Sources({ sources }: { sources: SourceRef[] }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={[styles.pill, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Icon name="link" size={14} color={palette.textMuted} strokeWidth={2} />
        <Text style={[styles.pillText, { color: palette.textMuted }]}>
          {sources.length === 1 ? '1 Source' : `${sources.length} Sources`}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {sources.map((source) => (
            <Pressable
              key={source.index}
              disabled={!source.url}
              onPress={() => source.url && void openLink(source.url)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
              <Text style={[styles.index, { backgroundColor: palette.surfaceStrong, color: palette.textMuted }]}>{source.index}</Text>
              <View style={styles.rowText}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                  {source.title}
                </Text>
                {source.url ? (
                  <Text style={[styles.host, { color: palette.textMuted }]} numberOfLines={1}>
                    {hostOf(source.url)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, gap: 6 },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontFamily: fonts.medium, fontSize: 12 },
  list: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: radius.sm },
  index: {
    minWidth: 20,
    textAlign: 'center',
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  rowText: { flex: 1 },
  title: { fontFamily: fonts.medium, fontSize: 14 },
  host: { fontFamily: fonts.regular, fontSize: 12 },
});
