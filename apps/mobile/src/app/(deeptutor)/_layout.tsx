import { Redirect, Stack } from 'expo-router';
import { DtLiveProvider } from '@/features/deeptutor/chat/DtLiveProvider';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { usePalette } from '@/theme';

/** The DeepTutor space: behind its own sign-in, with its own screens, cached data and live connection. */
export default function DeepTutorLayout() {
  const { state } = useDeepTutor();
  const palette = usePalette();
  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') return <Redirect href="/deeptutor-login" />;
  return (
    <DtLiveProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} />
    </DtLiveProvider>
  );
}
