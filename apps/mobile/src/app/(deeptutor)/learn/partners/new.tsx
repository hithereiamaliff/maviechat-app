import { createPartner, DtHttpError, PARTNER_COLORS, PARTNER_LANGUAGES, sameSelection, type DtLlmSelection } from '@maviechat/deeptutor-protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { showActionSheet } from '@/components/dialogs';
import { DtHeader } from '@/features/deeptutor/DtHeader';
import { FacePicker, PARTNER_EMOJIS } from '@/features/deeptutor/partners/FacePicker';
import { useDtSkillNames, useDtSouls, usePartnersRefresh } from '@/features/deeptutor/partners/queries';
import { useDtLlmOptions } from '@/features/deeptutor/queries';
import { describeError } from '@/lib/errors';
import { useDtAuthed } from '@/session/DeepTutorProvider';
import { fonts, radius, usePalette } from '@/theme';

/**
 * A new partner, in one page: its face (a photo, or an emoji on a colour), name, what it's for and reply
 * language; its soul, from DeepTutor's library or in your own words; and its model. It gets every
 * tool you may use and your skills, as DeepTutor's own form gives it; the rest is set later.
 */
export default function NewPartner() {
  const palette = usePalette();
  const toast = useToast();
  const { client } = useDtAuthed();
  const refresh = usePartnersRefresh();
  const souls = useDtSouls();
  const skills = useDtSkillNames();
  const models = useDtLlmOptions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emoji, setEmoji] = useState(PARTNER_EMOJIS[0] as string);
  const [color, setColor] = useState<string>(PARTNER_COLORS[3]);
  const [avatar, setAvatar] = useState('');
  const [language, setLanguage] = useState('');
  const [soulMode, setSoulMode] = useState<'library' | 'custom'>('library');
  const [soulId, setSoulId] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [model, setModel] = useState<DtLlmSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const library = souls.data ?? [];
  const chosenSoul = library.find((soul) => soul.id === soulId) ?? library[0];
  const languageLabel = PARTNER_LANGUAGES.find((item) => item.code === language)?.label ?? language;
  const ready = name.trim().length > 0 && (soulMode === 'library' ? Boolean(chosenSoul) : custom.trim().length > 0) && !busy;

  const pickLanguage = () =>
    showActionSheet({ title: 'Reply language', options: [...PARTNER_LANGUAGES.map((item) => item.label), 'Cancel'], cancelButtonIndex: PARTNER_LANGUAGES.length }, (index) => {
      const picked = PARTNER_LANGUAGES[index];
      if (picked) setLanguage(picked.code);
    });

  const create = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const { partner, startError } = await createPartner(client, {
        name,
        description,
        emoji,
        color,
        avatar,
        language,
        soul: soulMode === 'library' && chosenSoul ? { source: 'library', id: chosenSoul.id } : { source: 'custom', content: custom },
        llmSelection: model,
        skills: skills.data ?? [],
      });
      refresh();
      if (startError) toast(`${partner.name} was made, but didn’t start: it starts when you message it.`);
      router.replace({ pathname: '/learn/partners/[id]', params: { id: partner.id } });
    } catch (error) {
      setBusy(false);
      toast(error instanceof DtHttpError && error.status === 409 ? 'You already have a partner with this name. Choose another.' : `Couldn’t make the partner: ${describeError(error)}`, 'error');
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <DtHeader title="New Partner" />
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <FacePicker
            name={name}
            emoji={emoji}
            color={color}
            avatar={avatar}
            onChange={(face) => {
              if (face.emoji !== undefined) setEmoji(face.emoji);
              if (face.color !== undefined) setColor(face.color);
              if (face.avatar !== undefined) setAvatar(face.avatar);
            }}
          />

          <Text style={[styles.label, { color: palette.textMuted }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ada"
            placeholderTextColor={palette.textFaint}
            autoCapitalize="words"
            maxLength={80}
            accessibilityLabel="Name"
            style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Text style={[styles.label, { color: palette.textMuted }]}>What it’s for</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Helps me practise maths every evening"
            placeholderTextColor={palette.textFaint}
            multiline
            accessibilityLabel="Description"
            style={[styles.input, styles.short, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
          />
          <Pressable accessibilityRole="button" onPress={pickLanguage} style={[styles.choice, { borderColor: palette.border }]}>
            <Text style={[styles.choiceLabel, { color: palette.text }]}>Reply language</Text>
            <Text style={[styles.choiceValue, { color: palette.textMuted }]}>{languageLabel}</Text>
            <Icon name="chevron-down" size={14} color={palette.textMuted} />
          </Pressable>

          <Text style={[styles.label, { color: palette.textMuted }]}>Soul</Text>
          <Text style={[styles.hint, { color: palette.textFaint }]}>Who the partner is and how it talks, in every message.</Text>
          <View style={[styles.segments, { backgroundColor: palette.surfaceStrong }]} accessibilityRole="radiogroup">
            {(
              [
                ['library', 'From the Library'],
                ['custom', 'In Your Words'],
              ] as const
            ).map(([mode, label]) => (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === soulMode }}
                onPress={() => setSoulMode(mode)}
                style={[styles.segment, mode === soulMode && { backgroundColor: palette.background }]}>
                <Text style={[styles.segmentText, { color: mode === soulMode ? palette.text : palette.textMuted }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {soulMode === 'library' ? (
            souls.isLoading ? (
              <ActivityIndicator color={palette.textMuted} />
            ) : (
              <>
                <View style={styles.chips}>
                  {library.map((soul) => {
                    const selected = soul.id === chosenSoul?.id;
                    return (
                      <Pressable
                        key={soul.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => setSoulId(soul.id)}
                        style={[styles.chip, { borderColor: selected ? palette.text : palette.border, backgroundColor: selected ? palette.surfaceStrong : 'transparent' }]}>
                        <Text style={[styles.chipText, { color: selected ? palette.text : palette.textMuted }]}>{soul.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {chosenSoul ? (
                  <View style={[styles.soul, { borderColor: palette.border, backgroundColor: palette.surface }]}>
                    <Text style={[styles.soulText, { color: palette.textMuted }]} numberOfLines={8}>
                      {chosenSoul.content.trim()}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setCustom(chosenSoul.content);
                        setSoulMode('custom');
                      }}
                      hitSlop={6}>
                      <Text style={[styles.link, { color: palette.link }]}>Change it in your words</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={[styles.hint, { color: palette.textFaint }]}>The library is empty. Write the soul in your words.</Text>
                )}
              </>
            )
          ) : (
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder={'# Ada\nYou are a patient maths tutor. Ask one question at a time…'}
              placeholderTextColor={palette.textFaint}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
              accessibilityLabel="Soul"
              style={[styles.input, styles.long, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            />
          )}

          <Text style={[styles.label, { color: palette.textMuted }]}>Model</Text>
          <View style={[styles.group, { borderColor: palette.border }]}>
            {[null, ...(models.data?.options ?? [])].map((option, index) => {
              const selected = option ? sameSelection(model, option) : model === null;
              return (
                <Pressable
                  key={option ? `${option.profile_id}/${option.model_id}` : 'default'}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setModel(option ? { profile_id: option.profile_id, model_id: option.model_id } : null)}
                  style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border }]}>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, { color: palette.text }]}>{option ? option.label : 'DeepTutor’s default'}</Text>
                    {option?.profileName ? <Text style={[styles.hint, { color: palette.textFaint }]}>{option.profileName}</Text> : null}
                  </View>
                  {selected ? <Icon name="check" size={16} color={palette.link} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: palette.textFaint }]}>
            It gets every tool you may use and your skills, as DeepTutor’s own form gives it. Change its tools and library in its settings afterwards; chat apps are set up on DeepTutor’s web page.
          </Text>

          <View style={styles.create}>
            <Button label="Create Partner" loading={busy} disabled={!ready} onPress={() => void create()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  label: { fontFamily: fonts.medium, fontSize: 13, marginTop: 12, marginLeft: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginHorizontal: 4 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 15 },
  short: { minHeight: 64, lineHeight: 21 },
  long: { minHeight: 180, lineHeight: 21 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 12, paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  choiceLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  choiceValue: { fontFamily: fonts.regular, fontSize: 15 },
  segments: { flexDirection: 'row', padding: 2, borderRadius: radius.md, marginTop: 4 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.md - 2 },
  segmentText: { fontFamily: fonts.medium, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  soul: { gap: 8, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  soulText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  link: { fontFamily: fonts.medium, fontSize: 14 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 15 },
  create: { marginTop: 16 },
});
