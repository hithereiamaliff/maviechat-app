import { Redirect, Stack } from 'expo-router';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { usePalette } from '@/theme';

/** The DeepTutor space: behind its own sign-in, with its own screens and cached data. */
export default function DeepTutorLayout() {
  const { state } = useDeepTutor();
  const palette = usePalette();
  if (state.status === 'loading') return null;
  if (state.status !== 'signed-in') return <Redirect href="/deeptutor-login" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} />;
}
