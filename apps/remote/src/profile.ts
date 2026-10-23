import { AccountError, type Account } from './accounts';

export const publicProfile = (account: Account) => ({ id: account.id, name: account.name, email: account.email, avatar: account.avatar });

/** Only bounded PNG pixels are accepted. No SVG, external image URLs, metadata or animated uploads. */
export function validateProfile(body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !['name', 'avatar'].includes(key)) || typeof body.name !== 'string') throw new AccountError(400, 'invalid_profile');
  const name = body.name.trim();
  if (!name || [...name].length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new AccountError(400, 'invalid_name');
  if (body.avatar === null) return { name, avatar: null };
  if (typeof body.avatar !== 'string' || body.avatar.length > 100_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.avatar)) throw new AccountError(400, 'invalid_avatar');
  const data = Buffer.from(body.avatar.slice(22), 'base64');
  if (data.toString('base64') !== body.avatar.slice(22) || data.length < 45 || data.length > 72 * 1024 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AccountError(400, 'invalid_avatar');
  let offset = 8, pixels = false, ended = false;
  while (offset + 12 <= data.length) {
    const size = data.readUInt32BE(offset), kind = data.toString('ascii', offset + 4, offset + 8);
    if (offset + size + 12 > data.length || !['IHDR', 'IDAT', 'IEND'].includes(kind)) throw new AccountError(400, 'invalid_avatar');
    if (offset === 8) {
      if (kind !== 'IHDR' || size !== 13 || !data.readUInt32BE(16) || !data.readUInt32BE(20) || data.readUInt32BE(16) > 128 || data.readUInt32BE(20) > 128) throw new AccountError(400, 'invalid_avatar');
    } else if (kind === 'IHDR') throw new AccountError(400, 'invalid_avatar');
    if (kind === 'IDAT') pixels = true;
    offset += size + 12;
    if (kind === 'IEND') { ended = size === 0 && pixels && offset === data.length; break; }
  }
  if (!ended) throw new AccountError(400, 'invalid_avatar');
  return { name, avatar: body.avatar };
}
