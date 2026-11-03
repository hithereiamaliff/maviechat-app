import { REPLY_LANGUAGES, updateUiSettings } from '@maviechat/deeptutor-protocol';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { DtPickSheet } from '@/features/deeptutor/chat/DtExtrasViews';
import { DT_SETTINGS_PAGE } from '@/features/deeptutor/pages';
import { useDtUiSettings } from '@/features/deeptutor/queries';
import { GeneralSettings } from '@/features/settings/GeneralSettings';
import { describeError } from '@/lib/errors';
import { DT_QUERY_ROOT, useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/** Opens one of DeepTutor's own pages from the Settings modal (the modal closes first). */
export function openDtPage(path: string, title: string): void {
  router.dismissAll();
  router.replace({ pathname: '/learn/web', params: { path, title } });
}

/** General in DeepTutor's Settings: the app's theme and notifications, then DeepTutor's reply language and the rest of its settings. */
export function DtGeneralSettings() {
  const palette = usePalette();
  const { client, session } = useDtAuthed();
  const queryClient = useQueryClient();
  const ui = useDtUiSettings();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const current = ui.data?.response_language ?? null;
  const currentName = REPLY_LANGUAGES.find((language) => language.code === current)?.name ?? current ?? '…';

  const pick = async (code: string) => {
    setPicking(false);
    if (code === current) return;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await updateUiSettings(client, { response_language: code });
      queryClient.setQueryData([DT_QUERY_ROOT, session.baseUrl, 'ui-settings'], saved);
    } catch (error) {
      setProblem(`Couldn't change the language: ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GeneralSettings note="DeepTutor's own settings are below.">
      <View style={styles.wrap}>
        <Text style={[styles.section, { color: palette.textMuted }]}>DeepTutor</Text>
        <View style={[styles.group, { borderColor: palette.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Picks the language DeepTutor replies in"
            disabled={!ui.data || saving}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.label, { color: palette.text }]}>Reply language</Text>
            {saving || ui.isLoading ? (
              <ActivityIndicator color={palette.textMuted} />
            ) : (
              <>
                <Text style={[styles.value, { color: palette.textMuted }]}>{currentName}</Text>
                <Icon name="chevron-right" size={14} color={palette.textFaint} strokeWidth={2} />
              </>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens DeepTutor's own settings page"
            onPress={() => openDtPage(DT_SETTINGS_PAGE.path, DT_SETTINGS_PAGE.label)}
            style={({ pressed }) => [styles.row, styles.divider, { borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.label, { color: palette.text }]}>More DeepTutor Settings</Text>
            <Icon name="arrow-top-right-on-square" size={15} color={palette.textFaint} />
          </Pressable>
        </View>
        {problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}
        {ui.isError ? <Text style={[styles.note, { color: palette.danger }]}>{`Couldn't load DeepTutor's settings: ${describeError(ui.error)}`}</Text> : null}
        <Text style={[styles.note, { color: palette.textFaint }]}>
          The reply language is saved to your DeepTutor account, so it applies on the web too. Appearance, workspaces, memory, tools and (for admins) models are in DeepTutor&apos;s own settings.
        </Text>
      </View>
      <DtPickSheet
        visible={picking}
        title="Reply Language"
        note="DeepTutor answers in this language unless you ask for another."
        items={REPLY_LANGUAGES.map((language) => ({ id: language.code, label: language.name }))}
        selected={current ? [current] : []}
        loading={false}
        empty=""
        onToggle={(item) => void pick(item.id)}
        onClose={() => setPicking(false)}
      />
    </GeneralSettings>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 16 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  value: { fontFamily: fonts.regular, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
});
