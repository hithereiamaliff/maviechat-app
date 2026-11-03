import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { openLink } from '@/lib/links';
import { fonts, radius, usePalette } from '@/theme';
import type { Explainer } from './explainers';

interface ExplainerSheetProps {
  explainer: Explainer | null;
  onClose: () => void;
  /** Its sign-in (the sheet closes first). */
  onAction: (route: NonNullable<Explainer['action']>['route']) => void;
  /** From a product's explainer to "No server yet?". */
  onNoServer?: () => void;
}

/** A sheet explaining Open WebUI, DeepTutor, or what to do without a server, in plain words. */
export function ExplainerSheet({ explainer, onClose, onAction, onNoServer }: ExplainerSheetProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const action = explainer?.action;
  return (
    <Modal visible={explainer !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {explainer ? (
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
              {explainer.title}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={[styles.done, { color: palette.link }]}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={[styles.intro, { color: palette.text }]}>{explainer.intro}</Text>
            {explainer.sections.map((section) => (
              <View key={section.heading} style={styles.section}>
                <Text style={[styles.heading, { color: palette.textMuted }]} accessibilityRole="header">
                  {section.heading}
                </Text>
                {section.text ? <Text style={[styles.text, { color: palette.text }]}>{section.text}</Text> : null}
                {section.bullets?.map((bullet) => (
                  <View key={bullet} style={styles.bullet}>
                    <Text style={[styles.text, { color: palette.textMuted }]}>•</Text>
                    <Text style={[styles.text, styles.bulletText, { color: palette.text }]}>{bullet}</Text>
                  </View>
                ))}
              </View>
            ))}
            {explainer.links?.length ? (
              <View style={[styles.links, { borderColor: palette.border }]}>
                {explainer.links.map((link, index) => (
                  <Pressable
                    key={link.url}
                    accessibilityRole="link"
                    onPress={() => void openLink(link.url)}
                    style={({ pressed }) => [
                      styles.link,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
                      pressed && { backgroundColor: palette.surface },
                    ]}>
                    <Text style={[styles.linkText, { color: palette.link }]}>{link.label}</Text>
                    <Icon name="arrow-top-right-on-square" size={15} color={palette.textFaint} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {action ? (
              <View style={styles.action}>
                <Button label={action.label} onPress={() => onAction(action.route)} />
              </View>
            ) : null}
            {onNoServer ? (
              <Pressable accessibilityRole="button" onPress={onNoServer} hitSlop={8} style={styles.nudge}>
                <Text style={[styles.nudgeText, { color: palette.link }]}>No server yet? What to do</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 19 },
  done: { fontFamily: fonts.semibold, fontSize: 16 },
  content: { paddingHorizontal: 20, paddingTop: 4, gap: 20 },
  intro: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  section: { gap: 6 },
  heading: { fontFamily: fonts.medium, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  text: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bullet: { flexDirection: 'row', gap: 8 },
  bulletText: { flex: 1 },
  links: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 14 },
  linkText: { flex: 1, fontFamily: fonts.medium, fontSize: 15 },
  action: { marginTop: 4 },
  nudge: { alignSelf: 'center', paddingVertical: 4 },
  nudgeText: { fontFamily: fonts.medium, fontSize: 15 },
});
