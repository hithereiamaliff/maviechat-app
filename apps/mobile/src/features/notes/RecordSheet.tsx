import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { SYSTEM_SETTINGS } from '@/lib/device';
import { describeError } from '@/lib/errors';
import type { Picked } from '@/lib/pickedFiles';
import { fonts, radius, usePalette } from '@/theme';

/** A name for the recording, from when it was made. */
function recordingName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `Recording ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.m4a`;
}

const clock = (millis: number) => {
  const seconds = Math.floor(millis / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Records a voice note for a note (the web's Record): it starts at once, can pause, and Add to
 * Note hands the recording over to be added as the note's file, which the server writes out in
 * your Speech to Text language. Leaving any other way keeps nothing.
 */
export function RecordSheet({ visible, onClose, onRecorded }: { visible: boolean; onClose: () => void; onRecorded: (file: Picked) => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Recorder onClose={onClose} onRecorded={onRecorded} /> : null}
    </Modal>
  );
}

type Phase = 'starting' | 'recording' | 'paused' | 'saving' | 'denied';

function Recorder({ onClose, onRecorded }: { onClose: () => void; onRecorded: (file: Picked) => void }) {
  const palette = usePalette();
  const toast = useToast();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<Phase>('starting');

  const failed = useEffectEvent((error: unknown) => {
    toast(`Couldn’t start recording: ${describeError(error)}`, 'error');
    onClose();
  });
  // Asks for the microphone, then starts at once; leaving stops it, keeping nothing that wasn't
  // added, and the phone's audio goes back to playing as usual.
  useEffect(() => {
    let live = true;
    requestRecordingPermissionsAsync()
      .then(async (permission) => {
        if (!live) return;
        if (!permission.granted) return setPhase('denied');
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await recorder.prepareToRecordAsync();
        if (!live) return;
        recorder.record();
        setPhase('recording');
      })
      .catch((error: unknown) => {
        if (live) failed(error);
      });
    return () => {
      live = false;
      void recorder
        .stop()
        .catch(() => undefined)
        .finally(() => void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined));
    };
  }, [recorder]);

  const pauseOrResume = () => {
    if (phase === 'recording') {
      recorder.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      recorder.record();
      setPhase('recording');
    }
  };

  const add = async () => {
    setPhase('saving');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('there’s no recording');
      const size = new File(uri).size;
      onRecorded({ uri, name: recordingName(), size: typeof size === 'number' ? size : undefined, mimeType: 'audio/mp4' });
    } catch (error) {
      toast(`Couldn’t keep the recording: ${describeError(error)}`, 'error');
    }
    onClose();
  };

  // The level: the recorder's dB (−60 or quieter shows nothing).
  const level = typeof state.metering === 'number' && phase === 'recording' ? Math.min(1, Math.max(0, (state.metering + 60) / 60)) : 0;

  return (
    <View style={[styles.sheet, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10}>
          <Text style={[styles.action, { color: palette.link }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Record
        </Text>
        <View style={styles.side} />
      </View>
      {phase === 'denied' ? (
        <View style={styles.center}>
          <Text style={[styles.message, { color: palette.textMuted }]}>{`MavieChat can’t use the microphone. Allow it in ${SYSTEM_SETTINGS} → MavieChat → Microphone.`}</Text>
          <View style={styles.buttons}>
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
        </View>
      ) : (
        <View style={styles.center}>
          <Text accessibilityRole="timer" accessibilityLabel={`Recorded ${clock(state.durationMillis)}`} style={[styles.time, { color: palette.text }]}>
            {clock(state.durationMillis)}
          </Text>
          <View style={[styles.meter, { backgroundColor: palette.surfaceStrong }]}>
            <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%`, backgroundColor: palette.danger }]} />
          </View>
          <Text style={[styles.status, { color: palette.textMuted }]}>{phase === 'paused' ? 'Paused' : phase === 'recording' ? 'Recording…' : phase === 'saving' ? 'Adding…' : 'Starting…'}</Text>
          {phase === 'starting' || phase === 'saving' ? (
            <ActivityIndicator color={palette.textMuted} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={phase === 'paused' ? 'Go on recording' : 'Pause'}
              onPress={pauseOrResume}
              style={({ pressed }) => [styles.round, { borderColor: palette.border, backgroundColor: pressed ? palette.surfaceStrong : 'transparent' }]}>
              <Icon name={phase === 'paused' ? 'microphone' : 'pause-circle'} size={30} color={phase === 'paused' ? palette.danger : palette.text} />
            </Pressable>
          )}
          <View style={styles.buttons}>
            <Button label="Add to Note" onPress={() => void add()} disabled={phase !== 'recording' && phase !== 'paused'} />
          </View>
          <Text style={[styles.note, { color: palette.textFaint }]}>The recording is added to the note, and your server writes out what’s said, in your Speech to Text language.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  action: { fontFamily: fonts.regular, fontSize: 16, minWidth: 60 },
  side: { minWidth: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 18 },
  time: { fontFamily: fonts.mono, fontSize: 48 },
  meter: { width: '70%', height: 6, borderRadius: radius.full, overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: radius.full },
  status: { fontFamily: fonts.medium, fontSize: 14 },
  round: { width: 72, height: 72, borderRadius: 36, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  buttons: { alignSelf: 'stretch', gap: 10 },
  message: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
