import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ExplainerSheet } from '@/features/welcome/ExplainerSheet';
import { EXPLAINERS, type ExplainerKey } from '@/features/welcome/explainers';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { fonts, radius, usePalette } from '@/theme';

interface Choice {
  key: Exclude<ExplainerKey, 'no-server'>;
  name: string;
  description: string;
  icon: IconName;
  route: '/login' | '/deeptutor-login';
}

const CHOICES: Choice[] = [
  {
    key: 'owui',
    name: 'Open WebUI',
    description: 'Chat with the AI models on your Open WebUI server.',
    icon: 'chat-bubble-left-right',
    route: '/login',
  },
  {
    key: 'deeptutor',
    name: 'DeepTutor',
    description: 'Learn with your DeepTutor server: solve problems, take quizzes, research topics and more.',
    icon: 'academic-cap',
    route: '/deeptutor-login',
  },
];

/**
 * The first screen when neither side is signed in (a first launch, or after signing out of
 * both): pick Open WebUI or DeepTutor, each as much a home as the other. The other can be
 * added later from the account menu. Each has an explainer (what it is, how it differs), and
 * people without a server find out what to do.
 */
export default function Welcome() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const owui = useSession().state.status;
  const deepTutor = useDeepTutor().state.status;
  const [explaining, setExplaining] = useState<ExplainerKey | null>(null);

  // Signed in on either side already (back here by a stray link): go there.
  if (owui === 'signed-in') return <Redirect href="/" />;
  if (deepTutor === 'signed-in') return <Redirect href="/learn" />;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Welcome to MavieChat
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>Where would you like to start? You can add the other one later.</Text>
      </View>

      <View style={styles.choices}>
        {CHOICES.map((choice) => (
          <Pressable
            key={choice.key}
            accessibilityRole="button"
            accessibilityLabel={`${choice.name}. ${choice.description}`}
            accessibilityHint="Opens its sign-in"
            // VoiceOver reads the card as one button, so its explainer is a custom action too.
            accessibilityActions={[{ name: 'explain', label: `What is ${choice.name}?` }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'explain') setExplaining(choice.key);
            }}
            onPress={() => router.replace({ pathname: choice.route, params: { from: 'welcome' } })}
            style={({ pressed }) => [styles.choice, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : palette.background }]}>
            <View style={[styles.badge, { backgroundColor: palette.surfaceStrong }]}>
              <Icon name={choice.icon} size={26} color={palette.text} />
            </View>
            <View style={styles.choiceText}>
              <Text style={[styles.name, { color: palette.text }]}>{choice.name}</Text>
              <Text style={[styles.description, { color: palette.textMuted }]}>{choice.description}</Text>
            </View>
            <IconButton icon="information-circle" label={`What is ${choice.name}?`} size={22} color={palette.textMuted} onPress={() => setExplaining(choice.key)} />
            <Icon name="chevron-right" size={16} color={palette.textFaint} strokeWidth={2} />
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" accessibilityHint="Explains what MavieChat needs" onPress={() => setExplaining('no-server')} hitSlop={8} style={styles.nudge}>
          <Text style={[styles.nudgeText, { color: palette.link }]}>{"I'm just a user and don't have a server"}</Text>
        </Pressable>
      </View>

      <Text style={[styles.footer, { color: palette.textMuted }]}>
        MavieChat is an independent app for Open WebUI and DeepTutor servers and is not affiliated with either.
      </Text>
      <ExplainerSheet
        explainer={explaining ? EXPLAINERS[explaining] : null}
        onClose={() => setExplaining(null)}
        onAction={(route) => {
          setExplaining(null);
          router.replace({ pathname: route, params: { from: 'welcome' } });
        }}
        onNoServer={explaining && explaining !== 'no-server' ? () => setExplaining('no-server') : undefined}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 32 },
  header: { gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 28 },
  subtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  choices: { gap: 14 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.xl },
  badge: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  choiceText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.semibold, fontSize: 17 },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  nudge: { alignSelf: 'center', paddingVertical: 6 },
  nudgeText: { fontFamily: fonts.medium, fontSize: 15, textAlign: 'center' },
  footer: { marginTop: 'auto', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
