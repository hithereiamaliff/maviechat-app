import { ScrollView, StyleSheet, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { NotificationSettings } from '@/features/settings/NotificationSettings';
import { usePalette } from '@/theme';

/** Notifications, from the OpenCode space: the same switch as in the other spaces' Settings. */
export default function OpenCodeNotifications() {
  const palette = usePalette();
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <BackHeader title="Notifications" fallback="/code" />
      <ScrollView contentContainerStyle={styles.content}>
        <NotificationSettings />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 32 },
});
