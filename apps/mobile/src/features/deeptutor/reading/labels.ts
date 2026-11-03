import type { DtMaterial } from '@maviechat/deeptutor-protocol';
import type { IconName } from '@/components/Icon';

/** A collection's colour (DeepTutor's names), for light and dark. */
export const COLLECTION_COLORS: Record<string, { light: string; dark: string; label: string }> = {
  '': { light: '#737373', dark: '#a3a3a3', label: 'Plain' },
  blue: { light: '#2563eb', dark: '#60a5fa', label: 'Blue' },
  teal: { light: '#0d9488', dark: '#2dd4bf', label: 'Teal' },
  green: { light: '#16a34a', dark: '#4ade80', label: 'Green' },
  amber: { light: '#d97706', dark: '#fbbf24', label: 'Amber' },
  orange: { light: '#ea580c', dark: '#fb923c', label: 'Orange' },
  rose: { light: '#e11d48', dark: '#fb7185', label: 'Rose' },
  violet: { light: '#7c3aed', dark: '#a78bfa', label: 'Violet' },
  slate: { light: '#475569', dark: '#94a3b8', label: 'Slate' },
};

/** Highlight colours as DeepTutor's reader paints them, see-through enough to read under. */
export const HIGHLIGHT_TINTS: Record<string, string> = {
  yellow: 'rgba(250, 205, 90, 0.42)',
  green: 'rgba(140, 219, 148, 0.42)',
  blue: 'rgba(122, 192, 250, 0.42)',
  pink: 'rgba(250, 161, 199, 0.42)',
  purple: 'rgba(199, 174, 250, 0.42)',
};
export const HIGHLIGHT_LABELS: Record<string, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink', purple: 'Purple' };

export function materialIcon(material: Pick<DtMaterial, 'kind' | 'renderMode'>): IconName {
  if (material.kind === 'youtube' || material.kind === 'bilibili' || material.renderMode === 'video') return 'film';
  if (material.renderMode === 'audio') return 'microphone';
  if (material.kind === 'web') return 'globe-alt';
  if (material.renderMode === 'epub') return 'book-open';
  return 'document-text';
}

/** What one locator is, capitalised: "Page", "Chapter"… */
export function unitName(unit: string): string {
  const name = unit || 'section';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Why a material couldn't be prepared, in plain words (DeepTutor's error codes). */
export function failureText(material: Pick<DtMaterial, 'errorCode' | 'errorDetail'>): string {
  switch (material.errorCode) {
    case 'web_fetch_failed':
      return "The page couldn't be fetched.";
    case 'youtube_transcript_failed':
      return "The video's captions couldn't be fetched.";
    case 'bilibili_metadata_failed':
      return "The video's details couldn't be fetched.";
    case 'stt_not_configured':
      return 'DeepTutor has no speech-to-text set up, so it can’t transcribe this.';
    case 'media_transcription_failed':
      return 'The transcription failed.';
    case 'media_source_missing':
      return 'The uploaded file is missing.';
    default:
      return material.errorDetail || "It couldn't be prepared.";
  }
}
