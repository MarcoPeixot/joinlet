/** Shared browser/server rules. Passwords are preserved exactly, without trimming or normalization. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_INPUT_LENGTH = 256;
export const PASSWORD_MAX_LENGTH = 128;

/** Bound credential input without imposing a new-password policy on existing accounts. */
export function isPasswordInput(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PASSWORD_MAX_INPUT_LENGTH && [...value].length <= PASSWORD_MAX_LENGTH;
}

export function isNewPassword(value: unknown): value is string {
  return isPasswordInput(value) && [...value].length >= PASSWORD_MIN_LENGTH && /[\p{P}\p{S}]/u.test(value);
}
