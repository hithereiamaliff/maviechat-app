import { usableCliApps } from '@maviechat/deeptutor-protocol';
import { router, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { useAgentConnections, useCliApps, usePersonalizationRefresh, usePersonas, useSkills } from '@/features/deeptutor/personalization/queries';
import { fonts, radius, usePalette } from '@/theme';

interface Tile {
  key: string;
  title: string;
  blurb: string;
  icon: IconName;
  /** The app's own page, or else DeepTutor's (`web`). */
  route?: Href;
  web?: string;
  count?: string;
}

/**
 * All Personalization, as DeepTutor's hub: what's yours in every workspace, each with how many
 * there are. Personas and Skills open here; the rest open DeepTutor's own pages for now.
 */
export default function Personalization() {
  const palette = usePalette();
  const refresh = usePersonalizationRefresh();
  const agents = useAgentConnections();
  const personas = usePersonas();
  const skills = useSkills();
  const cli = useCliApps();
  const plural = (count: number | undefined, one: string, many: string) => (count === undefined ? undefined : `${count} ${count === 1 ? one : many}`);

  const tiles: Tile[] = [
    { key: 'agents', title: 'My Agents', blurb: 'Agent programs on the server a chat can consult, and conversations imported from them.', icon: 'cpu-chip', web: '/agents', count: agents.data === null ? undefined : plural(agents.data?.length, 'agent', 'agents') },
    { key: 'personas', title: 'Personas', blurb: 'Voices a chat can answer in.', icon: 'identification', route: '/learn/personas', count: plural(personas.data?.length, 'persona', 'personas') },
    { key: 'skills', title: 'Skills', blurb: 'Playbooks the model opens when a chat needs one.', icon: 'sparkles', route: '/learn/skills', count: plural(skills.data?.length, 'skill', 'skills') },
    // No count: reading the list makes DeepTutor connect to every server in it.
    { key: 'mcp', title: 'MCP Services', blurb: 'Outside tools a chat can use, through MCP servers.', icon: 'puzzle-piece', web: '/space/mcp' },
    { key: 'cli-apps', title: 'CLI Apps', blurb: 'Command-line programs on the server a chat can run.', icon: 'command-line', web: '/space/cli-apps', count: cli.data ? plural(usableCliApps(cli.data).length, 'app', 'apps') : undefined },
    { key: 'memory', title: 'Memory', blurb: 'What DeepTutor has learned about you and your work.', icon: 'light-bulb', web: '/memory' },
  ];

  const open = (tile: Tile) => {
    if (tile.route) router.push(tile.route);
    else if (tile.web) router.push({ pathname: '/learn/web', params: { path: tile.web, title: tile.title } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="Personalization" />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}>
        <Text style={[styles.intro, { color: palette.textMuted }]}>Your agents, voices, skills, tools and memory. They’re yours in every workspace.</Text>
        {tiles.map((tile) => (
          <Pressable
            key={tile.key}
            accessibilityRole="button"
            accessibilityLabel={[tile.title, tile.count, tile.blurb].filter(Boolean).join(', ')}
            accessibilityHint={tile.route ? undefined : "Opens DeepTutor's page"}
            onPress={() => open(tile)}
            style={({ pressed }) => [styles.tile, { borderColor: palette.border, backgroundColor: pressed ? palette.surface : 'transparent' }]}>
            <View style={[styles.mark, { backgroundColor: palette.surfaceStrong }]}>
              <Icon name={tile.icon} size={20} color={palette.text} />
            </View>
            <View style={styles.text}>
              <View style={styles.titleLine}>
                <Text style={[styles.title, { color: palette.text }]}>{tile.title}</Text>
                {tile.count ? <Text style={[styles.count, { color: palette.textMuted }]}>{tile.count}</Text> : null}
              </View>
              <Text style={[styles.blurb, { color: palette.textMuted }]}>{tile.blurb}</Text>
            </View>
            <Icon name={tile.route ? 'chevron-right' : 'arrow-top-right-on-square'} size={14} color={palette.textFaint} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg },
  mark: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 15 },
  count: { fontFamily: fonts.regular, fontSize: 13 },
  blurb: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
