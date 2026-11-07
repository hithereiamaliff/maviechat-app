import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SideScroll } from '@/components/SideScroll';
import { ChatHeader } from '@/features/chat/ChatHeader';
import { KnowledgeTab } from '@/features/workspace/KnowledgeTab';
import { ModelsTab } from '@/features/workspace/ModelsTab';
import { PromptsTab } from '@/features/workspace/PromptsTab';
import { SkillsTab } from '@/features/workspace/SkillsTab';
import { ToolsTab } from '@/features/workspace/ToolsTab';
import { useAuthed, useCapabilities } from '@/lib/server';
import { fonts, usePalette } from '@/theme';

type Area = 'models' | 'knowledge' | 'prompts' | 'skills' | 'tools';
const AREAS: { key: Area; label: string }[] = [
  { key: 'models', label: 'Models' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'skills', label: 'Skills' },
  { key: 'tools', label: 'Tools' },
];

/**
 * Open WebUI's Workspace: the areas this account may use, as tabs over each area's list (its
 * count on the open one). Tools' code is written on the web (saving a tool runs it on the server).
 */
export default function Workspace() {
  const palette = usePalette();
  const { session } = useAuthed();
  const capabilities = useCapabilities();
  const allowed = AREAS.filter((area) => (capabilities?.isAdmin || capabilities?.can(`workspace.${area.key}`)) && (area.key !== 'tools' || capabilities?.feature('tools')));
  // A link to a Workspace area (`/workspace/prompts`) opens on its tab.
  const { area: linked } = useLocalSearchParams<{ area?: string }>();
  const [picked, setPicked] = useState<Area | null>(() => AREAS.find((item) => item.key === linked)?.key ?? null);
  const area = allowed.find((item) => item.key === picked)?.key ?? allowed[0]?.key ?? null;
  const tabs = (count?: number) => (
    <SideScroll showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {allowed.map((item) => {
        const on = item.key === area;
        return (
          <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setPicked(item.key)} style={[styles.tab, on && { borderBottomColor: palette.text }]}>
            <Text style={[styles.tabText, { color: on ? palette.text : palette.textMuted }]}>{on && count !== undefined ? `${item.label} ${count}` : item.label}</Text>
          </Pressable>
        );
      })}
    </SideScroll>
  );
  const openWeb = () => void WebBrowser.openBrowserAsync(`${session.baseUrl}/workspace${area ? `/${area}` : ''}`);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ChatHeader title="Workspace" menu={[{ key: 'web', label: 'Open on the Web', icon: 'globe-alt', onPress: openWeb }]} />
      {!area ? (
        <Text style={[styles.note, styles.center, styles.pad, { color: palette.textMuted }]}>Your account has no Workspace areas. An admin gives them.</Text>
      ) : area === 'models' ? (
        <ModelsTab tabs={tabs} />
      ) : area === 'knowledge' ? (
        <KnowledgeTab tabs={tabs} />
      ) : area === 'prompts' ? (
        <PromptsTab tabs={tabs} />
      ) : area === 'skills' ? (
        <SkillsTab tabs={tabs} />
      ) : (
        <ToolsTab tabs={tabs} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  tabs: { gap: 4 },
  tab: { paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontFamily: fonts.medium, fontSize: 14 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center' },
});
