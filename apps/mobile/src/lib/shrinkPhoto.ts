import { fitWithin, uuidv4 } from '@maviechat/owui-protocol';
import { File, Paths } from 'expo-file-system';
import type { PictureMaker } from '@/features/settings/PictureMaker';
import { readAsDataUrl, type Picked } from './pickedFiles';

/**
 * As the web does before sending a photo: shrunk to your "Image Compression" size, capped by the
 * admin's limits, keeping its shape. If that fails, the photo goes as it is.
 */
export async function shrinkPhoto(file: Picked, limits: { width: number | null; height: number | null } | null, maker: PictureMaker): Promise<Picked> {
  const target = limits && file.width && file.height ? fitWithin(file.width, file.height, limits) : null;
  if (!target) return file;
  try {
    const smaller = await maker.fit(await readAsDataUrl(file.uri, file.mimeType ?? 'image/jpeg'), target.width, target.height);
    const name = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
    const out = new File(Paths.cache, `shrunk-${uuidv4().slice(0, 8)}-${name}`);
    out.create({ overwrite: true });
    await out.write(smaller.replace(/^data:[^,]*,/, ''), { encoding: 'base64' });
    return { ...file, uri: out.uri, name, size: out.size ?? undefined, mimeType: 'image/jpeg', width: target.width, height: target.height };
  } catch {
    return file;
  }
}
