import { useWindowDimensions } from 'react-native';
import { isWideWidth } from './layoutRules';

export { CONTENT_MAX_WIDTH, FORM_MAX_WIDTH, SHEET_MAX_WIDTH, WIDE_MIN_WIDTH, isWideWidth } from './layoutRules';

/** The window's layout: wide (an iPad or another big screen: the sidebar beside the content) or narrow (the phone layout). */
export function useLayout(): { wide: boolean } {
  const { width } = useWindowDimensions();
  return { wide: isWideWidth(width) };
}
