import { SPEECH_RATES, speechRate, speechRateLabel, stepSpeechRate } from '@maviechat/owui-protocol';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { DEVICE } from '@/lib/device';
import { setDevicePrefs, useDevicePrefs } from '@/lib/devicePrefs';
import { speakText, stopReading, useReadingAloud } from '@/lib/readAloud';
import { useCapabilities, useUserSettings } from '@/lib/server';
import { useCanSaveSettings, useSaveUiSettings } from '@/lib/uiSettings';
import { fonts, usePalette } from '@/theme';
import { ActionRow, Group, Note, rowStyles, SectionTitle, SwitchRow } from './rows';
import { VoicePicker } from './VoicePicker';
import { voiceName, voiceSample } from './voices';

interface ReadAloudControls {
  rate: number;
  onRate: (rate: number) => void;
  autoPlay: boolean;
  onAutoPlay: (on: boolean) => void;
  /** False when the account may not change these (Open WebUI's admin can forbid it). */
  editable: boolean;
  note: string;
}

/** Read Aloud's settings, the same in both spaces: the voice (this iPhone's), the speed, and reading each reply when it's done. */
function ReadAloudSettings({ rate, onRate, autoPlay, onAutoPlay, editable, note }: ReadAloudControls) {
  const palette = usePalette();
  const { voice } = useDevicePrefs();
  const [picking, setPicking] = useState(false);
  const sampling = useReadingAloud('audio-sample');
  const lowest = SPEECH_RATES[0];
  const highest = SPEECH_RATES[SPEECH_RATES.length - 1];

  return (
    <ScrollView contentContainerStyle={rowStyles.content}>
      <SectionTitle title="Read Aloud" />
      <Group>
        <ActionRow label="Voice" value={voice ? voiceName(voice) : 'Phone default'} onPress={() => setPicking(true)} />
        <View style={styles.speed}>
          <Text style={[styles.label, { color: editable ? palette.text : palette.textMuted }]}>Speed</Text>
          <IconButton icon="minus" label="Slower" size={18} disabled={!editable || rate <= lowest} onPress={() => onRate(stepSpeechRate(rate, -1))} />
          <Text style={[styles.rate, { color: palette.text }]} accessibilityLabel={`Speed ${speechRateLabel(rate)}`}>
            {speechRateLabel(rate)}
          </Text>
          <IconButton icon="plus" label="Faster" size={18} disabled={!editable || rate >= highest} onPress={() => onRate(stepSpeechRate(rate, 1))} />
        </View>
        <SwitchRow label="Read replies when they finish" hint="The reply on screen is read aloud as soon as it’s done." value={autoPlay} disabled={!editable} onChange={onAutoPlay} />
      </Group>
      <View style={styles.sample}>
        <Button
          label={sampling ? 'Stop' : 'Play a Sample'}
          variant="secondary"
          onPress={() => {
            if (sampling) stopReading();
            else speakText('audio-sample', voiceSample(voice?.language ?? 'en'), { rate, force: true });
          }}
        />
      </View>
      <Note>{note}</Note>
      <VoicePicker visible={picking} rate={rate} onClose={() => setPicking(false)} />
    </ScrollView>
  );
}

/** Open WebUI's Audio tab: speed and auto-playback are saved with your account (the web uses them too). */
export function OwuiAudioSettings() {
  const settings = useUserSettings();
  const capabilities = useCapabilities();
  const save = useSaveUiSettings();
  const canSave = useCanSaveSettings();
  const ui = settings.data?.ui;
  if (capabilities && !capabilities.can('chat.tts', true)) {
    return (
      <ScrollView contentContainerStyle={rowStyles.content}>
        <Note>Your admin turned Read Aloud off for this account.</Note>
      </ScrollView>
    );
  }
  return (
    <ReadAloudSettings
      rate={speechRate(ui)}
      onRate={(rate) => void save({ 'audio.tts.playbackRate': rate })}
      autoPlay={ui?.responseAutoPlayback === true}
      onAutoPlay={(on) => void save({ responseAutoPlayback: on })}
      editable={canSave}
      note={
        canSave
          ? `Voices differ from device to device, so the voice is kept on this ${DEVICE} (DeepTutor uses it too). Speed and reading replies when they finish are saved with your account, so the web app follows them.`
          : `Your admin doesn’t let this account change its settings. The voice is kept on this ${DEVICE}.`
      }
    />
  );
}

/** DeepTutor's Audio tab: DeepTutor keeps no such settings, so they're kept on this iPhone. */
export function DtAudioSettings() {
  const prefs = useDevicePrefs();
  return (
    <ReadAloudSettings
      rate={prefs.deepTutorRate}
      onRate={(rate) => setDevicePrefs({ deepTutorRate: rate })}
      autoPlay={prefs.deepTutorAutoPlay}
      onAutoPlay={(on) => setDevicePrefs({ deepTutorAutoPlay: on })}
      editable
      note={`Kept on this ${DEVICE}. The voice is the one Open WebUI’s Read Aloud uses too.`}
    />
  );
}

const styles = StyleSheet.create({
  speed: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 46, paddingLeft: 14, paddingRight: 6, paddingVertical: 4 },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 15 },
  rate: { minWidth: 52, textAlign: 'center', fontFamily: fonts.medium, fontSize: 15 },
  sample: { marginTop: 8 },
});
