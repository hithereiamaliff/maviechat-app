import {
  attachWebAddress,
  fileItemFromUpload,
  fitWithin,
  imageLimits,
  inlineImageItem,
  isWebAddress,
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
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '@/components/Toast';
import { deepTutorAttachment } from '@/features/deeptutor/crossReference';
import { describeError } from '@/lib/errors';
import { usePictureMaker } from '@/features/settings/PictureMaker';
import { useAuthed, useCapabilities, useServerConfig, useUserSettings } from '@/lib/server';
import { useInterface } from '@/lib/uiSettings';
import { useDeepTutor } from '@/session/DeepTutorProvider';
import { useSession } from '@/session/SessionProvider';
import { isPhoto, photo, PHOTO_OPTIONS, readAsDataUrl, type Picked } from '@/lib/pickedFiles';
import { uploadPart } from '@/lib/uploadPart';
import { getDraft, patchFile, removeFile, updateDraft } from './drafts';

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
  const deepTutor = useDeepTutor();
  const ui = useInterface();
  const settings = useUserSettings();
  const picture = usePictureMaker();

  // As the web does before sending a photo: shrunk to your "Image Compression" size, capped by the
  // admin's limits, keeping its shape. If that fails, the photo goes as it is.
  const shrink = async (file: Picked): Promise<Picked> => {
    const limits = imageLimits(settings.data?.ui, config.data);
    const target = limits && file.width && file.height ? fitWithin(file.width, file.height, limits) : null;
    if (!target) return file;
    try {
      const smaller = await picture.maker.fit(await readAsDataUrl(file.uri, file.mimeType ?? 'image/jpeg'), target.width, target.height);
      const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
      const out = new File(Paths.cache, `shrunk-${uuidv4().slice(0, 8)}-${name}`);
      out.create({ overwrite: true });
      await out.write(smaller.replace(/^data:[^,]*,/, ''), { encoding: 'base64' });
      return { ...file, uri: out.uri, name, size: out.size ?? undefined, mimeType: 'image/jpeg', width: target.width, height: target.height };
    } catch {
      return file;
    }
  };

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
      // "Send whole documents" (Interface), or a long paste: read in full rather than searched, as the web marks it.
      ...(!image && (file.context === 'full' || ui('defaultUploadContext')) ? { context: 'full' } : {}),
    };
    updateDraft(draftKey, (draft) => ({
      ...draft,
      files: [...draft.files, placeholder],
      previews: image ? { ...draft.previews, [itemId]: file.uri } : draft.previews,
    }));
    try {
      const form = new FormData();
      // React Native uploads a local file given as {uri, name, type}.
      form.append('file', uploadPart({ uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' }));
      const uploaded = await uploadFile(client, form, { process: !image });
      if (typeof uploaded.error === 'string' && uploaded.error) toast(uploaded.error);
      if (!image && (await waitForProcessing(client, uploaded.id)) === 'failed') throw new Error("the server couldn't read it");
      const item = fileItemFromUpload(uploaded, { name: file.name, size: file.size, itemId });
      patchFile(draftKey, itemId, placeholder.context ? { ...item, context: placeholder.context } : item);
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
        void shrink(file).then(keepPhoto);
      } else if (!modelSupports(model, 'file_upload')) {
        refusals.add('Model(s) do not support file upload');
      } else if (temporary) {
        void keepText(file);
      } else if (image) {
        void shrink(file).then((small) => upload(small, true));
      } else {
        void upload(file, false);
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

  // A DeepTutor chat travels as text with the message (nothing is uploaded), so only the file count applies.
  const attachDeepTutorChat = async (session: { id: string; title: string }) => {
    const dtClient = deepTutor.client;
    if (!dtClient) return;
    const limit = uploadLimitError(config.data, getDraft(draftKey).files.length, [{ size: 1 }]);
    if (limit) {
      toast(limit, 'error');
      return;
    }
    const itemId = uuidv4();
    const name = `DeepTutor - ${session.title || 'chat'}`;
    const placeholder: FileItem = { type: 'text', file: '', id: null, url: '', name, collection_name: '', status: 'uploading', size: 0, error: '', itemId };
    updateDraft(draftKey, (draft) => ({ ...draft, files: [...draft.files, placeholder] }));
    try {
      patchFile(draftKey, itemId, await deepTutorAttachment(dtClient, session.id, itemId));
    } catch (error) {
      removeFile(draftKey, itemId);
      toast(`Couldn't attach the DeepTutor chat: ${describeError(error)}`, 'error');
    }
  };

  // A file in the cache, for what came from the clipboard rather than a picker.
  const cached = async (name: string, write: (file: File) => Promise<void>): Promise<Picked> => {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    await write(file);
    return { uri: file.uri, name, size: file.size ?? undefined };
  };

  return {
    /** The hidden web view that shrinks photos: render it once where the attachments are used. */
    pictureElement: picture.element,
    /** The + menu's Attach Webpage: the server fetches the page, and its text goes with the message. */
    attachWebpage: async (address: string) => {
      const url = address.trim();
      if (capabilities && !capabilities.can('chat.web_upload', true)) return toast('You do not have permission to upload web content.', 'error');
      if (!isWebAddress(url)) return toast('That isn’t a web address. It starts with https://.', 'error');
      const itemId = uuidv4();
      updateDraft(draftKey, (draft) => ({ ...draft, files: [...draft.files, { type: 'text', id: null, url, name: url, status: 'uploading', itemId }] }));
      try {
        patchFile(draftKey, itemId, { ...(await attachWebAddress(client, url)), itemId });
      } catch (error) {
        removeFile(draftKey, itemId);
        toast(`Couldn't attach that page: ${describeError(error)}`, 'error');
      }
    },
    attachDeepTutorChat,
    /** A long paste, attached as the web attaches it: `Pasted_Text_….txt`, read in full. */
    attachText: (text: string) =>
      run(async () => [{ ...(await cached(`Pasted_Text_${uuidv4().slice(0, 8)}.txt`, (file) => file.write(text))), mimeType: 'text/plain', context: 'full' as const }]),
    /** The picture on the clipboard, as a photo (a phone can't paste one into the message box itself). */
    pasteImage: () =>
      run(async () => {
        const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.8 });
        if (!image?.data) {
          toast('There’s no picture on the clipboard.', 'error');
          return [];
        }
        const base64 = image.data.replace(/^data:[^,]*,/, '');
        return [
          {
            ...(await cached(`Pasted_Image_${uuidv4().slice(0, 8)}.jpg`, (file) => file.write(base64, { encoding: 'base64' }))),
            mimeType: 'image/jpeg',
            width: image.size?.width || undefined,
            height: image.size?.height || undefined,
          },
        ];
      }),
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
