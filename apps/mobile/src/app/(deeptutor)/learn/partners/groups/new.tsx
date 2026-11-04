import { createPartnerGroup } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { GroupForm, NEW_GROUP, type GroupDraft } from '@/features/deeptutor/partners/groups/GroupForm';
import { useDtPartners, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, usePalette } from '@/theme';

/** A new group: its face, name and purpose, two or more of your partners, and how they answer. */
export default function NewGroup() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = usePartnersRefresh();
  const partners = useDtPartners();
  const [draft, setDraft] = useState<GroupDraft>(NEW_GROUP);
  const [busy, setBusy] = useState(false);
  const list = partners.data ?? [];
  const ready = draft.name.trim().length > 0 && draft.memberIds.length >= 2 && !busy;

  const create = async () => {
    setBusy(true);
    try {
      const group = await createPartnerGroup(client, draft);
      refresh();
      router.replace({ pathname: '/learn/partners/groups/[id]', params: { id: group.id } });
    } catch (error) {
      setBusy(false);
      toast(`Couldn’t make the group: ${describeError(error)}`, 'error');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Group" />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {partners.isLoading ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : list.length < 2 ? (
            <View style={styles.center}>
              <Text style={[styles.note, { color: palette.textMuted }]}>A group needs two partners or more. Make another first.</Text>
              <Button label="New Partner" onPress={() => router.replace('/learn/partners/new')} />
            </View>
          ) : (
            <>
              <GroupForm draft={draft} onChange={setDraft} partners={list} isNew />
              <View style={styles.create}>
                <Button label={draft.memberIds.length < 2 ? `Pick ${2 - draft.memberIds.length} More` : 'Create Group'} loading={busy} disabled={!ready} onPress={() => void create()} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  center: { alignItems: 'center', gap: 14, marginTop: 32 },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  create: { marginTop: 16 },
});
