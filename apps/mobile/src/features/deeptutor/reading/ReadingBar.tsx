import { clock } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { SideScroll } from '@/components/SideScroll';
import { useDtCollection, useDtMaterial } from '@/features/deeptutor/queries';
import { fonts, radius, usePalette } from '@/theme';
import { unitName } from './labels';
import { readingPlaces, useReadingPlace } from './readingContext';

/**
 * Above a reading chat: the collection and the file you're reading (tap to read on), the pages
 * and moments the tutor's last answer cites, and the passage you're about to ask about (× to drop it).
 */
export function ReadingBar({ collectionId, materialId, cited, times = [] }: { collectionId: string; materialId: string; cited: number[]; times?: number[] }) {
  const palette = usePalette();
  const place = useReadingPlace(collectionId);
  const collection = useDtCollection(collectionId);
  const current = place?.materialId || materialId || collection.data?.collection.activeMaterialId || '';
  const detail = useDtMaterial(current);
  const missing = collection.isError;
  const unit = unitName(detail.data?.unit ?? 'page');
  const media = detail.data?.renderMode === 'video' || detail.data?.renderMode === 'audio';
  const here = place?.materialId === current ? place : undefined;
  const where = here ? (media && here.timeSeconds !== undefined ? clock(here.timeSeconds) : here.locator ? `${unit} ${here.locator}` : '') : '';
  const read = (at: { locator?: number; seconds?: number } = {}) =>
    current
      ? router.push({
          pathname: '/learn/reading/read',
          params: {
            collection: collectionId,
            material: current,
            ...(at.locator ? { locator: String(at.locator) } : {}),
            ...(at.seconds !== undefined ? { t: String(Math.floor(at.seconds)) } : {}),
          },
        })
      : undefined;

  return (
    <View style={[styles.wrap, { borderBottomColor: palette.border }]}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the reader" disabled={missing || !current} onPress={() => read({ locator: here?.locator, seconds: media ? here?.timeSeconds : undefined })} style={styles.top} hitSlop={4}>
        <Icon name="book-open" size={16} color={palette.textMuted} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {missing ? 'A collection that is no longer here' : detail.data?.title || 'Reading'}
          </Text>
          <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
            {[collection.data?.collection.title, where].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {missing ? null : <Icon name="chevron-right" size={14} color={palette.textFaint} />}
      </Pressable>
      {(cited.length || times.length) && current ? (
        <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Text style={[styles.sub, { color: palette.textMuted }]}>Cited:</Text>
          {times.slice(0, 12).map((seconds) => (
            <Pressable
              key={`t${seconds}`}
              accessibilityRole="button"
              accessibilityLabel={`Play from ${clock(seconds)}`}
              onPress={() => read({ seconds })}
              style={[styles.chip, { borderColor: palette.border }]}>
              <Text style={[styles.chipText, { color: palette.link }]}>{clock(seconds)}</Text>
            </Pressable>
          ))}
          {cited.slice(0, 12).map((locator) => (
            <Pressable key={locator} accessibilityRole="button" accessibilityLabel={`Read ${unit} ${locator}`} onPress={() => read({ locator })} style={[styles.chip, { borderColor: palette.border }]}>
              <Text style={[styles.chipText, { color: palette.link }]}>{`${unit === 'Page' ? 'p.' : `${unit} `}${locator}`}</Text>
            </Pressable>
          ))}
        </SideScroll>
      ) : null}
      {place?.selection ? (
        <View style={[styles.passage, { backgroundColor: palette.surface }]}>
          <Text style={[styles.passageText, { color: palette.text }]} numberOfLines={3}>{`Asking about: “${place.selection}”`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Don't ask about the passage" onPress={() => readingPlaces.takeSelection(collectionId)} hitSlop={8}>
            <Icon name="x-mark" size={16} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  sub: { fontFamily: fonts.regular, fontSize: 12 },
  chips: { alignItems: 'center', gap: 6 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 },
  chipText: { fontFamily: fonts.medium, fontSize: 12 },
  passage: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: radius.md, padding: 10 },
  passageText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
