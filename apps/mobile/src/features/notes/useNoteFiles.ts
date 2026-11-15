import { fileItemFromUpload, imageLimits, OwuiHttpError, uploadFile, uuidv4, type FileItem } from '@maviechat/owui-protocol';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { describeError } from '@/lib/errors';
import { isPhoto, photo, PHOTO_OPTIONS, type Picked } from '@/lib/pickedFiles';
import { useAuthed, useCapabilities, useServerConfig, useUserSettings } from '@/lib/server';
import { shrinkPhoto } from '@/lib/shrinkPhoto';
import { uploadPart } from '@/lib/uploadPart';
import { useSession } from '@/session/SessionProvider';

/** Where files for a note come from: Files, Photos, the camera, or Files for a recording. */
export type NoteFileSource = 'files' | 'photos' | 'camera' | 'audio';

/** A file uploaded for a note: a picture goes in the text, anything else is attached. */
export interface UploadedNoteFile {
  picture: boolean;
  /** The upload as the web keeps it (0.11's file list holds this). */
  entry: FileItem & { id: string };
}

type Tree = Record<string, unknown>;
const record = (value: unknown): Tree => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Tree) : {});

/**
 * Adding files to a note, as the web's note does: each is uploaded at once; documents and
 * recordings are read by the server as they arrive (a recording is written out in your Speech to
 * Text language, as on the web), pictures are stored as they are, shrunk first as for a chat.
 */
export function useNoteFiles() {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const capabilities = useCapabilities();
  const config = useServerConfig();
  const settings = useUserSettings();
  const toast = useToast();
  const pictures = usePictureMaker();
  const [uploading, setUploading] = useState(0);

  const pick = async (source: NoteFileSource): Promise<Picked[]> => {
    if (source === 'photos') {
      const result = await ImagePicker.launchImageLibraryAsync({ ...PHOTO_OPTIONS, allowsMultipleSelection: true, selectionLimit: 10 });
      return result.canceled ? [] : result.assets.map(photo);
    }
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        toast('Allow camera access for MavieChat in Settings to take photos.', 'error');
        return [];
      }
      const result = await ImagePicker.launchCameraAsync(PHOTO_OPTIONS);
      return result.canceled ? [] : result.assets.map(photo);
    }
    const result = await DocumentPicker.getDocumentAsync({ multiple: source === 'files', copyToCacheDirectory: true, ...(source === 'audio' ? { type: 'audio/*' } : {}) });
    return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType }));
  };

  const tooBig = (files: Picked[]): string | null => {
    const maxSize = record(config.data?.file).max_size;
    if (typeof maxSize === 'number' && files.some((file) => (file.size ?? 0) > maxSize * 1024 * 1024)) return `File size should not exceed ${maxSize} MB.`;
    if (files.some((file) => file.size === 0)) return 'You cannot upload an empty file.';
    return null;
  };

  const upload = async (file: Picked): Promise<UploadedNoteFile> => {
    const picture = isPhoto(file);
    const ready = picture ? await shrinkPhoto(file, imageLimits(settings.data?.ui, config.data), pictures.maker) : file;
    const form = new FormData();
    form.append('file', uploadPart({ uri: ready.uri, name: ready.name, type: ready.mimeType ?? 'application/octet-stream' }));
    const language = record(record(record(settings.data?.ui).audio).stt).language;
    if (typeof language === 'string' && language && /^(audio|video)\//.test(ready.mimeType ?? '')) form.append('metadata', JSON.stringify({ language }));
    const uploaded = await uploadFile(client, form, { process: !picture });
    if (typeof uploaded.error === 'string' && uploaded.error) toast(uploaded.error);
    const entry = fileItemFromUpload(uploaded, { name: ready.name, size: ready.size, itemId: uuidv4() });
    return { picture, entry: { ...entry, id: uploaded.id } };
  };

  const allowed = (): boolean => {
    if (capabilities && !capabilities.can('chat.file_upload', true)) {
      toast('You do not have permission to upload files.', 'error');
      return false;
    }
    return true;
  };

  /** Picks from `source`, then uploads each, handing each one over as it's done. */
  const add = async (source: NoteFileSource, each: (file: UploadedNoteFile) => void) => {
    if (!allowed()) return;
    let picked: Picked[];
    try {
      picked = await pick(source);
    } catch (error) {
      return toast(`Couldn’t open the picker: ${describeError(error)}`, 'error');
    }
    await addPicked(picked, each);
  };

  /** Uploads files the app already has (a recording just made), handing each one over as it's done. */
  const addPicked = async (picked: Picked[], each: (file: UploadedNoteFile) => void) => {
    if (!allowed()) return;
    const refusal = tooBig(picked);
    if (refusal) return toast(refusal, 'error');
    for (const file of picked) {
      setUploading((count) => count + 1);
      try {
        each(await upload(file));
      } catch (error) {
        toast(`Couldn’t add ${file.name}: ${describeError(error)}`, 'error');
        if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  return { add, addPicked, uploading, pictureElement: pictures.element };
}
