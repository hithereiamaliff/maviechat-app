import { DISCUSSION_MODES, GROUP_COLORS, type DtPartner } from '@maviechat/deeptutor-protocol';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { fonts, radius, usePalette } from '@/theme';
import { PartnerFace } from '../PartnerFace';

export interface GroupDraft {
  name: string;
  description: string;
  emoji: string;
  color: string;
  /** In the order they answer. */
  memberIds: string[];
  mode: string;
}

export const NEW_GROUP: GroupDraft = { name: '', description: '', emoji: '👥', color: GROUP_COLORS[0], memberIds: [], mode: 'panel_parallel' };

/**
 * A group's name and description, its members (two or more of your partners; the order they're
 * picked in is the order they answer) and how they take turns. Emoji and colour only when it's new,
 * as DeepTutor keeps them from then on.
 */
export function GroupForm({ draft, onChange, partners, isNew }: { draft: GroupDraft; onChange: (draft: GroupDraft) => void; partners: DtPartner[]; isNew: boolean }) {
  const palette = usePalette();
  const edit = (change: Partial<GroupDraft>) => onChange({ ...draft, ...change });
  const toggle = (id: string) => edit({ memberIds: draft.memberIds.includes(id) ? draft.memberIds.filter((member) => member !== id) : [...draft.memberIds, id] });
  return (
    <View style={styles.form}>
      {isNew ? (
        <View style={styles.identity}>
          <View style={[styles.tile, { backgroundColor: `${draft.color}33` }]}>
            <TextInput value={draft.emoji} onChangeText={(emoji) => edit({ emoji: emoji.slice(0, 4) })} accessibilityLabel="Emoji" style={styles.tileEmoji} maxLength={8} />
          </View>
          <View style={styles.colors}>
            {GROUP_COLORS.map((color) => (
              <Pressable
                key={color}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === draft.color }}
                accessibilityLabel={`Colour ${color}`}
                onPress={() => edit({ color })}
                style={[styles.swatch, { backgroundColor: color, borderColor: color === draft.color ? palette.text : palette.background }]}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
      <TextInput value={draft.name} onChangeText={(name) => edit({ name })} placeholder="Study panel" placeholderTextColor={palette.textFaint} maxLength={80} accessibilityLabel="Name" style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]} />
      <Text style={[styles.label, { color: palette.textMuted }]}>What it’s for</Text>
      <TextInput
        value={draft.description}
        onChangeText={(description) => edit({ description: description.slice(0, 500) })}
        placeholder="A maths tutor and a writing coach on every essay"
        placeholderTextColor={palette.textFaint}
        multiline
        accessibilityLabel="Description"
        style={[styles.input, styles.short, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
      />

      <Text style={[styles.label, { color: palette.textMuted }]}>{`Members${draft.memberIds.length ? ` (${draft.memberIds.length})` : ''}`}</Text>
      <Text style={[styles.hint, { color: palette.textFaint }]}>Pick two or more. They answer in the order you pick them.</Text>
      <View style={[styles.group, { borderColor: palette.border }]}>
        {partners.map((partner, index) => {
          const at = draft.memberIds.indexOf(partner.id);
          return (
            <Pressable
              key={partner.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: at >= 0 }}
              onPress={() => toggle(partner.id)}
              style={[styles.member, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
              <PartnerFace face={partner} size={28} />
              <View style={styles.memberText}>
                <Text style={[styles.memberName, { color: palette.text }]} numberOfLines={1}>
                  {partner.name}
                </Text>
                {partner.description ? (
                  <Text style={[styles.hint, { color: palette.textMuted }]} numberOfLines={1}>
                    {partner.description}
                  </Text>
                ) : null}
              </View>
              {at >= 0 ? (
                <View style={[styles.order, { backgroundColor: palette.primary }]}>
                  <Text style={[styles.orderText, { color: palette.onPrimary }]}>{at + 1}</Text>
                </View>
              ) : (
                <Icon name="plus" size={16} color={palette.textFaint} />
              )}
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, { color: palette.textMuted }]}>How they answer</Text>
      <View style={[styles.group, { borderColor: palette.border }]}>
        {DISCUSSION_MODES.map((item, index) => {
          const selected = item.mode === draft.mode;
          return (
            <Pressable
              key={item.mode}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => edit({ mode: item.mode })}
              style={[styles.member, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
              <View style={styles.memberText}>
                <Text style={[styles.memberName, { color: palette.text }]}>{item.label}</Text>
                <Text style={[styles.hint, { color: palette.textMuted }]}>{item.hint}</Text>
              </View>
              {selected ? <Icon name="check" size={16} color={palette.link} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: palette.textFaint }]}>Each member’s reasoning and tools are shown to you only; the members see each other’s answers.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  tile: { width: 64, height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 30, textAlign: 'center', minWidth: 48, padding: 0 },
  colors: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 10, marginLeft: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  short: { minHeight: 64, lineHeight: 21 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  memberText: { flex: 1, gap: 2 },
  memberName: { fontFamily: fonts.regular, fontSize: 15 },
  order: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  orderText: { fontFamily: fonts.semibold, fontSize: 12 },
});
