import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { startWay, waysFor } from '@/features/deeptutor/learning/ways';
import { useDtAuthStatus, useDtModules } from '@/features/deeptutor/queries';
import { fonts, radius, usePalette } from '@/theme';

/**
 * New Learning Activity: the ways to learn this account may start (those the server has switched
 * on, and a learner's policy allows), each with what it does. Mastery paths and practice start
 * here, as do books and reading collections.
 */
export default function NewLearningActivity() {
  const palette = usePalette();
  const modules = useDtModules();
  const status = useDtAuthStatus();
  const ways = waysFor(modules.data, status.data);
  const loading = modules.isLoading || status.isLoading;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Learning Activity" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>Choose how you want to learn. You can come back to it any time from All Learning.</Text>
        {loading ? <ActivityIndicator style={styles.loading} color={palette.textMuted} /> : null}
        {!loading && ways.length === 0 ? (
          <Text style={[styles.intro, { color: palette.textMuted }]}>None of DeepTutor&apos;s ways to learn are open to this account. Ask whoever runs your DeepTutor.</Text>
        ) : null}
        {ways.map((way) => (
          <Pressable
            key={way.kind}
            accessibilityRole="button"
            onPress={() => startWay(way)}
            style={({ pressed }) => [styles.card, { borderColor: palette.border }, pressed && { backgroundColor: palette.surface }]}>
            <View style={styles.top}>
              <View style={[styles.tile, { backgroundColor: palette.surface }]}>
                <Icon name={way.icon} size={20} color={palette.text} />
              </View>
              <Text style={[styles.title, { color: palette.text }]}>{way.label}</Text>
              <Icon name="chevron-right" size={16} color={palette.textFaint} />
            </View>
            <Text style={[styles.summary, { color: palette.text }]}>{way.summary}</Text>
            {way.points.map((point) => (
              <View key={point} style={styles.point}>
                <Icon name="check" size={14} color={palette.success} strokeWidth={2} />
                <Text style={[styles.pointText, { color: palette.textMuted }]}>{point}</Text>
              </View>
            ))}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  loading: { marginTop: 24 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: 16, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17 },
  summary: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pointText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
});
