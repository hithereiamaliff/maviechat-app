import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useToast } from '@/components/Toast';
import { describePushError } from '@/features/notifications/relay';
import { disablePush, enablePush, sendTestPush, usePushState } from '@/features/notifications/push';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

/** Notifications for replies that finish while MavieChat isn't on screen (this iPhone only). */
export function NotificationSettings() {
  const palette = usePalette();
  const toast = useToast();
  const { client, session } = useAuthed();
  const push = usePushState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const turn = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      if (on) {
        const status = await enablePush(client, session, { ask: true });
        setBlocked(status === 'blocked');
      } else {
        await disablePush(client);
      }
    } catch (error) {
      setProblem(describePushError(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      await sendTestPush(client);
      toast('Test sent. It arrives as a notification in a few seconds.', 'success');
    } catch (error) {
      toast(describePushError(error), 'error');
    }
  };

  const enabled = push?.enabled ?? false;
  return (
    <View style={styles.wrap}>
      <Text style={[styles.section, { color: palette.textMuted }]}>Notifications</Text>
      <View style={[styles.group, { borderColor: palette.border }]}>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Reply finished</Text>
          {busy ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : (
            <Switch accessibilityLabel="Notify me when a reply finishes" value={enabled} onValueChange={(on) => void turn(on)} />
          )}
        </View>
        {enabled ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void test()}
            style={({ pressed }) => [styles.row, styles.divider, { borderTopColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <Text style={[styles.label, { color: palette.link }]}>Send a Test Notification</Text>
          </Pressable>
        ) : null}
      </View>
      {problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}
      {blocked ? (
        <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={6}>
          <Text style={[styles.note, { color: palette.link }]}>Notifications are off for MavieChat in iOS Settings. Open Settings</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.note, { color: palette.textFaint }]}>
        {"Open WebUI tells this iPhone when a reply finishes or fails, with the chat title and the start of the reply, through MavieChat's notification service. While a chat is on screen, the app shows its own notice instead."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 16 },
  section: { fontFamily: fonts.medium, fontSize: 13, marginLeft: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginHorizontal: 4 },
});
