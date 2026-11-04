import { File } from 'expo-file-system';

/** A file picked on the phone: where its copy is, and its own name and type. */
export interface PickedUpload {
  uri: string;
  name: string;
  type: string;
}

/**
 * Bigger files are read into memory to be sent, so the app stops here (DeepTutor takes up to
 * 200 MB from its web app).
 */
export const PHONE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * A picked file as a part of a multipart upload. The app's fetch (Expo's) refuses React Native's
 * `{ uri, name, type }` parts before anything is sent, which surfaced as "couldn't reach the
 * server"; it sends parts that read their own bytes. This one reads the file as the request is
 * built, under its own name (the picker's copy has a made-up one).
 */
export function uploadPart(file: PickedUpload): Blob {
  return { name: file.name, type: file.type, bytes: () => new File(file.uri).bytes() } as unknown as Blob;
}

/** Text made on the phone (a web page's, or typed in) as an upload part: a plain-text file. */
export function textPart(name: string, text: string): Blob {
  return { name, type: 'text/plain', bytes: async () => new TextEncoder().encode(text) } as unknown as Blob;
}
