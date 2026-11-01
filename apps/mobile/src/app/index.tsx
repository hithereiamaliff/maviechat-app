import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';

export default function Index() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  return <Redirect href={state.status === 'signed-in' ? '/home' : '/login'} />;
}
