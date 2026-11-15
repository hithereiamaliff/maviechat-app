/** File types by name, for handing files to other apps. */
const TYPES: Record<string, string> = {
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  pdf: 'application/pdf',
  html: 'text/html',
  svg: 'image/svg+xml',
  py: 'text/x-python',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

/** A file's type from its name, for Android's share sheet (apps offer to open what they read). */
export function mimeTypeOf(uri: string): string | undefined {
  const name = uri.split(/[?#]/)[0] ?? '';
  const dot = name.lastIndexOf('.');
  return dot > name.lastIndexOf('/') ? TYPES[name.slice(dot + 1).toLowerCase()] : undefined;
}
