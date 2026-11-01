import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';

export * from './tokens';

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
