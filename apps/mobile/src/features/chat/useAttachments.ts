import {
  fileItemFromUpload,
  inlineImageItem,
  modelSupports,
  OwuiHttpError,
  readableAsText,
  textFileItem,
  uploadFile,
  uploadLimitError,
  uuidv4,
  waitForProcessing,
  type FileItem,
  type ModelItem,
} from '@maviechat/owui-protocol';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { useAuthed, useCapabilities, useServerConfig } from '@/lib/server';
import { useSession } from '@/session/SessionProvider';
import { getDraft, patchFile, removeFile, updateDraft } from './drafts';

interface Picked {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
}

const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.8,
  // JPEG rather than HEIC, so every model (and the web app) can show it.
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

function photo(asset: ImagePicker.ImagePickerAsset): Picked {
  // The picker may report the library's original name (IMG_1.HEIC) for the converted file.
  const extension = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
  const base = (asset.fileName ?? 'photo').replace(/\.[^.]+$/, '');
  return {
    uri: asset.uri,
    name: `${base}.${extension}`,
    size: asset.fileSize,
    mimeType: asset.mimeType ?? `image/${extension === 'jpg' ? 'jpeg' : extension}`,
  };
}

const isPhoto = (file: Picked) => (file.mimeType ?? '').startsWith('image/');

function readAsDataUrl(uri: string, mimeType: string): Promise<string> {
  return fetch(uri)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, `data:${mimeType}`));
          reader.onerror = () => reject(new Error('unreadable'));
          reader.readAsDataURL(blob);
        }),
    );
}

/**
 * The + menu: files, photos and the camera. Attachments upload right away, as on the web
 * (documents are also read by the server before they can be sent). A temporary chat stores
 * nothing, so its photos stay inline and text files are read on the phone.
 */
export function useAttachments({ draftKey, model, temporary }: { draftKey: string; model: ModelItem | undefined; temporary: boolean }) {
  const { client } = useAuthed();
  const { verifySession } = useSession();
  const capabilities = useCapabilities();
  const config = useServerConfig();
  const toast = useToast();

  const upload = async (file: Picked, image: boolean) => {
    const itemId = uuidv4();
    const placeholder: FileItem = {
      type: 'file',
      file: '',
      id: null,
      url: '',
      name: file.name,
      collection_name: '',
      status: 'uploading',
      size: file.size,
      error: '',
      itemId,
    };
    updateDraft(draftKey, (draft) => ({
      ...draft,
      files: [...draft.files, placeholder],
      previews: image ? { ...draft.previews, [itemId]: file.uri } : draft.previews,
    }));
    try {
      const form = new FormData();
      // React Native uploads a local file given as {uri, name, type}.
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
      const uploaded = await uploadFile(client, form, { process: !image });
      if (typeof uploaded.error === 'string' && uploaded.error) toast(uploaded.error);
      if (!image && (await waitForProcessing(client, uploaded.id)) === 'failed') throw new Error("the server couldn't read it");
      patchFile(draftKey, itemId, fileItemFromUpload(uploaded, { name: file.name, size: file.size, itemId }));
    } catch (error) {
      removeFile(draftKey, itemId);
      toast(`Couldn't attach ${file.name}: ${describeError(error)}`, 'error');
      if (error instanceof OwuiHttpError && error.isUnauthorized) verifySession();
    }
  };

  const keepPhoto = async (file: Picked) => {
    try {
      const url = await readAsDataUrl(file.uri, file.mimeType ?? 'image/jpeg');
      const itemId = uuidv4();
      updateDraft(draftKey, (draft) => ({
        ...draft,
        files: [...draft.files, { ...inlineImageItem(url), itemId }],
        previews: { ...draft.previews, [itemId]: file.uri },
      }));
    } catch {
      toast(`Couldn't read ${file.name}`, 'error');
    }
  };

  const keepText = async (file: Picked) => {
    if (!readableAsText(file.name, file.mimeType)) {
      toast(`A temporary chat can't read ${file.name}. Attach text files or photos.`, 'error');
      return;
    }
    try {
      const content = await (await fetch(file.uri)).text();
      const item = textFileItem({ name: file.name, size: file.size, content, itemId: uuidv4(), id: uuidv4() });
      updateDraft(draftKey, (draft) => ({ ...draft, files: [...draft.files, item] }));
    } catch {
      toast(`Couldn't read ${file.name}`, 'error');
    }
  };

  const add = (picked: Picked[]) => {
    if (picked.length === 0) return;
    if (capabilities && !capabilities.can('chat.file_upload', true)) {
      toast('You do not have permission to upload files.', 'error');
      return;
    }
    const limit = uploadLimitError(config.data, getDraft(draftKey).files.length, picked);
    if (limit) {
      toast(limit, 'error');
      return;
    }
    const refusals = new Set<string>();
    for (const file of picked) {
      const image = isPhoto(file);
      if (image && !modelSupports(model, 'vision')) {
        refusals.add('Selected model(s) do not support image inputs');
      } else if (image && temporary) {
        void keepPhoto(file);
      } else if (!modelSupports(model, 'file_upload')) {
        refusals.add('Model(s) do not support file upload');
      } else if (temporary) {
        void keepText(file);
      } else {
        void upload(file, image);
      }
    }
    for (const reason of refusals) toast(reason, 'error');
  };

  const run = async (pick: () => Promise<Picked[]>) => {
    try {
      add(await pick());
    } catch (error) {
      toast(`Couldn't open the picker: ${describeError(error)}`, 'error');
    }
  };

  return {
    pickFiles: () =>
      run(async () => {
        const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
        return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType }));
      }),
    pickPhotos: () =>
      run(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ ...PHOTO_OPTIONS, allowsMultipleSelection: true, selectionLimit: 10 });
        return result.canceled ? [] : result.assets.map(photo);
      }),
    capture: () =>
      run(async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          toast('Allow camera access for MavieChat in Settings to take photos.', 'error');
          return [];
        }
        const result = await ImagePicker.launchCameraAsync(PHOTO_OPTIONS);
        return result.canceled ? [] : result.assets.map(photo);
      }),
  };
}
