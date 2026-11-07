import * as ImagePicker from 'expo-image-picker';

/** A photo or file picked on the phone. */
export interface Picked {
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
  /** Read in full rather than searched (a long paste, as the web marks it). */
  context?: 'full';
}

export const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.8,
  // JPEG rather than HEIC, so every model (and the web app) can show it.
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

export function photo(asset: ImagePicker.ImagePickerAsset): Picked {
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

export const isPhoto = (file: Picked) => (file.mimeType ?? '').startsWith('image/');

/** The file as a data: URL (React Native reads local files through fetch). */
export function readAsDataUrl(uri: string, mimeType: string): Promise<string> {
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
