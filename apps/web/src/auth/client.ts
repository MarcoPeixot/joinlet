import { authText as uiText } from './messages';

const errors: Record<string, string> = {
  invalid_email: 'Informe um e-mail válido.',
  invalid_password: 'Use uma senha de 15 a 128 caracteres.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  sign_in_again: 'Entre novamente para continuar.',
  try_later: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  invalid_origin: 'Recarregue a página antes de tentar novamente.',
  invalid_profile: 'Confira os dados do perfil.',
  invalid_name: 'Use um nome de 1 a 80 caracteres, sem caracteres de controle.',
  invalid_avatar: 'Não foi possível salvar a foto. Escolha outra imagem.',
};
export const authFieldClass = 'w-full rounded-control border border-line bg-bg px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-50';
export async function authRequest<T>(path: string, body?: Record<string, string | null>, csrf?: string): Promise<T> {
  try {
    const response = await fetch('/api/auth/' + path, body ? {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'x-strukt-csrf': csrf } : {}) },
      body: JSON.stringify(body),
    } : { credentials: 'same-origin' });
    const result = await response.json();
    if (!response.ok) throw new Error(uiText(errors[result.error] ?? 'Não foi possível acessar sua conta. Tente novamente.'));
    return result as T;
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error(uiText('Não foi possível acessar sua conta. Tente novamente.'));
    throw error;
  }
}
