import { createCollection, isPreparing, type DtCollection } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { sessionDate, useDtCollections } from '@/features/deeptutor/queries';
import { CollectionSheet } from '@/features/deeptutor/reading/CollectionSheet';
import { COLLECTION_COLORS } from '@/features/deeptutor/reading/labels';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Your reading collections, the latest first: each a folder of files, links and videos read with the tutor. */
export default function ReadingCollections() {
  const palette = usePalette();
  const dark = useColorScheme() === 'dark';
  const toast = useToast();
  const queryClient = useQueryClient();
  const { client, session } = useDtAuthed();
  const params = useLocalSearchParams<{ new?: string }>();
  const collections = useDtCollections();
  const [creating, setCreating] = useState(params.new === '1');
  const [query, setQuery] = useState('');
  const list = collections.data?.collections ?? [];
  const canCreate = collections.data?.canCreate ?? false;
  const wanted = query.trim().toLocaleLowerCase();
  const shown = wanted ? list.filter((item) => `${item.title} ${item.description}`.toLocaleLowerCase().includes(wanted)) : list;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [DT_QUERY_ROOT, session.baseUrl, 'reading'] });

  const create = async (value: { name: string; color: string }) => {
    try {
      const made = await createCollection(client, { title: value.name, color: value.color });
      setCreating(false);
      refresh();
      router.push({ pathname: '/learn/reading/[id]', params: { id: made.id } });
    } catch (error) {
      toast(`Couldn't make the collection: ${describeError(error)}`, 'error');
    }
  };

  const tile = (collection: DtCollection) => {
    const swatch = COLLECTION_COLORS[collection.color] ?? COLLECTION_COLORS[''];
    const preparing = collection.materials.some(isPreparing);
    return (
      <Pressable
        key={collection.id}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/learn/reading/[id]', params: { id: collection.id } })}
        style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
        <View style={[styles.glyph, { backgroundColor: dark ? swatch?.dark : swatch?.light }]}>
          <Icon name="folder" size={18} color="#ffffff" />
        </View>
        <View style={styles.cardText}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
            {collection.title}
          </Text>
          <Text style={[styles.meta, { color: palette.textFaint }]}>
            {[`${collection.materials.length} ${collection.materials.length === 1 ? 'file' : 'files'}`, sessionDate(collection.updatedAt)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {preparing ? <ActivityIndicator size="small" color={palette.textMuted} /> : <Icon name="chevron-right" size={16} color={palette.textFaint} />}
      </Pressable>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Reading" accessory={canCreate ? <IconButton icon="plus" label="New Collection" onPress={() => setCreating(true)} /> : undefined} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        {list.length > 3 ? (
          <View style={[styles.search, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Icon name="magnifying-glass" size={16} color={palette.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search collections"
              placeholderTextColor={palette.textFaint}
              autoCorrect={false}
              style={[styles.searchInput, { color: palette.text }]}
              accessibilityLabel="Search collections"
            />
          </View>
        ) : null}
        {collections.isLoading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {collections.isError ? (
          <Pressable accessibilityRole="button" onPress={refresh}>
            <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load your collections: ${describeError(collections.error)}. Tap to try again.`}</Text>
          </Pressable>
        ) : null}
        {!collections.isLoading && !collections.isError && list.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No collections yet</Text>
            <Text style={[styles.note, { color: palette.textMuted }]}>
              {canCreate
                ? 'A collection holds what you read together: PDFs, e-books, documents, web pages and videos. The tutor reads along and answers from them.'
                : "This account can't make collections."}
            </Text>
            {canCreate ? <Button label="New Collection" onPress={() => setCreating(true)} /> : null}
          </View>
        ) : null}
        {wanted && shown.length === 0 && list.length ? <Text style={[styles.note, { color: palette.textMuted }]}>No collections match.</Text> : null}
        {shown.map(tile)}
      </ScrollView>
      <CollectionSheet visible={creating} title="New Collection" initial={{ name: '', color: '' }} onClose={() => setCreating(false)} onSave={create} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  loading: { marginTop: 32 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  empty: { gap: 10, marginTop: 24 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 12 },
  glyph: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 16 },
  meta: { fontFamily: fonts.regular, fontSize: 12 },
});
