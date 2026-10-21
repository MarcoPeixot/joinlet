import { uiText } from '../i18n';

/** Decode and rasterize uploads into a small portable image; never persist an external URL. */
export async function readWorkspaceLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(uiText('Escolha uma imagem PNG, JPG ou WebP válida.'));
  if (file.size > 2 * 1024 * 1024) throw new Error(uiText('A imagem deve ter até 2 MB.'));
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error(uiText('Não foi possível abrir esta imagem. Escolha outro arquivo.')); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(uiText('Não foi possível abrir esta imagem. Escolha outro arquivo.'));
    const scale = Math.min(256 / bitmap.width, 256 / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    ctx.drawImage(bitmap, (256 - width) / 2, (256 - height) / 2, width, height);
    return canvas.toDataURL('image/webp', 0.9);
  } finally { bitmap.close(); }
}
