import { DtHttpError } from '@maviechat/deeptutor-protocol';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { LinkSheet } from '@/features/deeptutor/partners/LinkSheet';
import { ChatAppsCard, IdentityCard, LibraryCard, ModelCard, SoulCard, ToolsCard } from '@/features/deeptutor/partners/PartnerSettingsCards';
import { useDtPartner } from '@/features/deeptutor/partners/queries';
import { describeError } from '@/lib/errors';
import { fonts, usePalette } from '@/theme';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/**
 * A partner's settings, as DeepTutor's Configure tab has them, for its owner: identity and
 * picture, soul, model and backup, tools, its library or a workspace, and its chat apps.
 */
export default function PartnerSettings() {
  const palette = usePalette();
  const partnerId = one(useLocalSearchParams<{ id: string }>().id);
  const partner = useDtPartner(partnerId);
  const [linking, setLinking] = useState(false);
  const data = partner.data;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title={data ? `${data.name} Settings` : 'Partner Settings'} />
      {!data ? (
        partner.isError ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>
            {partner.error instanceof DtHttpError && partner.error.status === 404 ? 'This partner is gone, or isn’t shared with you any more.' : `Couldn’t open it: ${describeError(partner.error)}`}
          </Text>
        ) : (
          <ActivityIndicator style={styles.loading} color={palette.textMuted} />
        )
      ) : !data.canManage ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>{`${data.name} is shared with you: only its owner can change its settings.`}</Text>
      ) : (
        <KeyboardAvoidingView behavior="padding" style={styles.screen}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <IdentityCard key={`identity-${data.id}`} partner={data} />
            <SoulCard partnerId={data.id} />
            <ModelCard partner={data} />
            <ToolsCard partner={data} />
            <LibraryCard partner={data} />
            <ChatAppsCard partner={data} onLink={() => setLinking(true)} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      {data ? <LinkSheet visible={linking} partnerId={data.id} name={data.name} channels={data.canManage ? data.channels : null} onClose={() => setLinking(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  loading: { marginTop: 32 },
  empty: { fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
