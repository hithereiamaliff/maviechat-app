import { PERMISSION_SECTIONS, permissionShown, type PermissionTree } from '@maviechat/owui-protocol';
import { Alert, StyleSheet, View } from 'react-native';
import { Group, Note, SectionTitle, SwitchRow } from '@/features/settings/rows';

const LABELS = new Map<string, string>(PERMISSION_SECTIONS.flatMap((section) => section.items.map((item): [string, string] => [`${section.key}.${item.key}`, `${section.label}: ${item.label}`])));

/** A switch's name for lists of changes. */
export const permissionLabel = (path: string): string => LABELS.get(path) ?? path;

/**
 * Every permission switch, in sections. For a group, `defaults` marks what everyone has anyway
 * (a group can't take it away) and a switch the group never set says so.
 */
export function PermissionsEditor({ tree, onChange, plugins, defaults }: { tree: PermissionTree; onChange: (path: string, on: boolean) => void; plugins: boolean; defaults?: PermissionTree }) {
  // What a dependent switch needs is judged on what the person ends up with.
  const shownOn: PermissionTree = defaults ? Object.fromEntries([...new Set([...Object.keys(defaults), ...Object.keys(tree)])].map((section) => [section, { ...(defaults[section] ?? {}), ...Object.fromEntries(Object.entries(tree[section] ?? {}).filter(([, on]) => on)) }])) : tree;
  return (
    <>
      {PERMISSION_SECTIONS.map((section) => {
        const items = section.items.filter((item) => permissionShown(item, shownOn, plugins));
        if (!items.length) return null;
        return (
          <View key={section.key} style={styles.section}>
            <SectionTitle title={section.label} />
            <Group>
            {items.map((item) => {
              const stored = tree[section.key]?.[item.key];
              const everyone = defaults?.[section.key]?.[item.key] === true;
              const hint = defaults ? (everyone ? 'Everyone has this by default' : stored === undefined ? 'Not set for this group' : undefined) : undefined;
              return <SwitchRow key={item.key} label={item.label} hint={hint} value={stored === true} onChange={(on) => onChange(`${section.key}.${item.key}`, on)} />;
            })}
            </Group>
          </View>
        );
      })}
      {defaults ? <Note>A group only adds to what everyone has: to keep something from some people, switch it off in the defaults and on in a group for the others.</Note> : null}
    </>
  );
}

/** Asks before saving permission changes, naming each one. */
export function confirmPermissionChanges(changes: string[], after: PermissionTree, where: string, save: () => void): void {
  const lines = changes.slice(0, 12).map((path) => {
    const [section = '', key = ''] = path.split('.');
    return `${after[section]?.[key] ? 'On' : 'Off'}: ${permissionLabel(path)}`;
  });
  const more = changes.length > 12 ? `\n…and ${changes.length - 12} more` : '';
  Alert.alert(`Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to ${where}?`, `${lines.join('\n')}${more}`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save', onPress: save },
  ]);
}

const styles = StyleSheet.create({
  section: { gap: 6 },
});
