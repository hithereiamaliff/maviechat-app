import type { DtAttachmentLimits } from '@maviechat/deeptutor-protocol';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '@/components/Toast';
import { isPhoto, photo, PHOTO_OPTIONS, readAsDataUrl, type Picked } from '@/lib/pickedFiles';
import { NO_EXTRAS, type DtExtras } from './extrasModel';
import { setStoredState, useStoredState } from './storedState';

export * from './extrasModel';

const key = (draftKey: string) => `dt-extras:${draftKey}`;

/** A chat's extras, kept with its draft while the app runs. */
export function useDtExtras(draftKey: string): [DtExtras, (next: DtExtras) => void] {
  return useStoredState<DtExtras>(key(draftKey), NO_EXTRAS);
}

export function clearExtras(draftKey: string): void {
  setStoredState(key(draftKey), NO_EXTRAS);
}

/** The new-chat screen's draft (DeepTutor's home). */
export const DT_NEW_CHAT = 'dt:new';

/** Starts a new chat that refers to a notebook or an earlier chat: home, with it already on the message. */
export function startChatWith(reference: { notebook: { id: string; name: string } } | { chat: { id: string; title: string } }): void {
  setStoredState(key(DT_NEW_CHAT), {
    ...NO_EXTRAS,
    ...('notebook' in reference ? { notebooks: [reference.notebook] } : { chats: [reference.chat] }),
  });
}

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Photos, the camera and files for a chat's next message, within DeepTutor's size limits. */
export function useDtAttach(draftKey: string, limits: DtAttachmentLimits) {
  const toast = useToast();
  const [extras, setExtras] = useDtExtras(draftKey);

  const add = async (picked: Picked[]) => {
    let next = extras;
    let used = next.attachments.reduce((sum, item) => sum + item.size, 0);
    for (const file of picked) {
      const mimeType = file.mimeType || 'application/octet-stream';
      try {
        const dataUrl = await readAsDataUrl(file.uri, mimeType);
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        // Base64 is a third larger than the file it encodes.
        const size = file.size ?? Math.floor((base64.length * 3) / 4);
        if (size > limits.maxFileBytes) {
          toast(`${file.name} is over DeepTutor's ${megabytes(limits.maxFileBytes)} limit.`, 'error');
          continue;
        }
        if (used + size > limits.maxTotalBytes) {
          toast(`Attachments can add up to ${megabytes(limits.maxTotalBytes)} a message.`, 'error');
          break;
        }
        used += size;
        const image = isPhoto(file) && !/svg/i.test(mimeType);
        next = {
          ...next,
          attachments: [
            ...next.attachments,
            { id: `${Date.now()}-${next.attachments.length}`, type: image ? 'image' : 'file', filename: file.name, mimeType, size, base64, preview: image ? dataUrl : null },
          ],
        };
      } catch {
        toast(`Couldn't read ${file.name}.`, 'error');
      }
    }
    setExtras(next);
  };

  return {
    extras,
    setExtras,
    pickPhotos: async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ ...PHOTO_OPTIONS, allowsMultipleSelection: true, selectionLimit: 10 });
      if (!result.canceled) await add(result.assets.map(photo));
    },
    takePhoto: async () => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        toast('Camera access is off for MavieChat in iOS Settings.', 'error');
        return;
      }
      const result = await ImagePicker.launchCameraAsync(PHOTO_OPTIONS);
      if (!result.canceled) await add(result.assets.map(photo));
    },
    pickFiles: async () => {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (!result.canceled) await add(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, size: asset.size ?? undefined, mimeType: asset.mimeType ?? undefined })));
    },
  };
}
