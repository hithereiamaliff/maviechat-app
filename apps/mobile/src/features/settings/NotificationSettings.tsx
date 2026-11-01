import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { deliveryProblem } from '@/features/notifications/iosDelivery';
import { disablePush, enablePush, sendTestPush, usePushState } from '@/features/notifications/push';
import { describePushError } from '@/features/notifications/relay';
import { watchForTest, type TestWatch } from '@/features/notifications/testWatch';
import { useAuthed } from '@/lib/server';
import { fonts, radius, usePalette } from '@/theme';

type TestState = { step: 'waiting' } | { step: 'arrived'; at: Date } | { step: 'missing' } | { step: 'failed'; message: string };

/** Notifications for finished replies (this iPhone only). */
export function NotificationSettings() {
  const palette = usePalette();
  const { client, session } = useAuthed();
  const push = usePushState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [testState, setTestState] = useState<TestState | null>(null);
  const [iosProblem, setIosProblem] = useState<string | null>(null);
  const watch = useRef<TestWatch | null>(null);

  // iOS's own settings for MavieChat, read again when you come back from the Settings app.
  useEffect(() => {
    const read = () => {
      Notifications.getPermissionsAsync().then(
        (permissions) => setIosProblem(deliveryProblem(permissions.ios)),
        () => undefined,
      );
    };
    read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      subscription.remove();
      watch.current?.stop();
    };
  }, []);

  const turn = async (on: boolean) => {
    setBusy(true);
    setProblem(null);
    setTestState(null);
    try {
      if (on) setBlocked((await enablePush(client, session, { ask: true })) === 'blocked');
      else await disablePush(session);
    } catch (error) {
      setProblem(describePushError(error));
    } finally {
      setBusy(false);
    }
  };

  // Settings covers the app's toasts, so the result shows here.
  const test = async () => {
    watch.current?.stop();
    const current = watchForTest();
    watch.current = current;
    setTestState({ step: 'waiting' });
    try {
      await sendTestPush(session);
    } catch (error) {
      current.stop();
      setTestState({ step: 'failed', message: describePushError(error) });
      return;
    }
    const outcome = await current.outcome;
    if (watch.current !== current) return;
    setTestState(outcome === 'arrived' ? { step: 'arrived', at: new Date() } : outcome === 'missing' ? { step: 'missing' } : null);
  };

  const enabled = push?.enabled ?? false;
  // The relay hears about replies only once an admin adds its webhook in Open WebUI.
  const waitingForServer = enabled && push?.lastEventAt === null;
  const testNote = testState ? describeTest(testState) : null;
  const testColor =
    testState?.step === 'arrived' ? palette.success : testState?.step === 'missing' || testState?.step === 'failed' ? palette.danger : palette.textMuted;

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
            {testState?.step === 'waiting' ? <ActivityIndicator color={palette.textMuted} /> : null}
          </Pressable>
        ) : null}
      </View>
      {testNote ? (
        <Text accessibilityLiveRegion="polite" style={[styles.note, { color: testColor }]}>
          {testNote}
        </Text>
      ) : null}
      {problem ? <Text style={[styles.note, { color: palette.danger }]}>{problem}</Text> : null}
      {blocked ? (
        <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={6}>
          <Text style={[styles.note, { color: palette.link }]}>Notifications are off for MavieChat in iOS Settings. Open Settings</Text>
        </Pressable>
      ) : null}
      {enabled && iosProblem ? (
        <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} hitSlop={6}>
          <Text style={[styles.note, { color: palette.link }]}>{`${iosProblem} Open Settings`}</Text>
        </Pressable>
      ) : null}
      {waitingForServer ? (
        <Text style={[styles.note, { color: palette.textMuted }]}>
          {"This iPhone is ready, but Open WebUI hasn't reported any replies to MavieChat's notification service yet. An admin adds its webhook once, in Open WebUI's Settings: Admin → System → General → Events → Webhooks."}
        </Text>
      ) : null}
      <Text style={[styles.note, { color: palette.textFaint }]}>
        {"When a reply finishes or fails, Open WebUI tells MavieChat's notification service, which notifies this iPhone with the chat title and the start of the reply. While MavieChat is open, every chat gets a banner except the one on screen."}
      </Text>
    </View>
  );
}

function describeTest(state: TestState): string {
  switch (state.step) {
    case 'waiting':
      return 'Sent. Waiting for it to reach this iPhone…';
    case 'arrived':
      return `Arrived on this iPhone at ${state.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}. No banner? A Focus such as Do Not Disturb may be on.`;
    case 'missing':
      return "Sent, but it hasn't reached this iPhone after 20 seconds. Check the connection, then try again.";
    case 'failed':
      return state.message;
  }
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
