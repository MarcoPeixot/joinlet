import { getLocale, uiText } from '../i18n';

// Loaded with the account screens, keeping their copy out of the initial editor bundle.
const english: Readonly<Record<string, string>> = {
  'Seu perfil': 'Your profile',
  'Editar perfil': 'Edit profile',
  'Fechar edição do perfil': 'Close profile editor',
  'Foto do perfil': 'Profile photo',
  'Escolher foto': 'Choose photo',
  'Remover foto': 'Remove photo',
  'Enviar foto do perfil': 'Upload profile photo',
  'Seu nome e foto identificam você. PNG, JPG ou WebP, até 2 MB.': 'Your name and photo identify you. PNG, JPG or WebP, up to 2 MB.',
  'Nome de exibição': 'Display name',
  'Conta #{0}': 'Account #{0}',
  'Salvar perfil': 'Save profile',
  'Perfil atualizado.': 'Profile updated.',
  'Escolha uma imagem PNG, JPG ou WebP de até 2 MB.': 'Choose a PNG, JPG or WebP image up to 2 MB.',
  'Não foi possível abrir esta imagem. Escolha outro arquivo.': 'This image could not be opened. Choose another file.',
  'Confira os dados do perfil.': 'Check the profile details.',
  'Use um nome de 1 a 80 caracteres, sem caracteres de controle.': 'Use a name with 1 to 80 characters, without control characters.',
  'Não foi possível salvar a foto. Escolha outra imagem.': 'The photo could not be saved. Choose another image.',
  "Informe um e-mail válido.": "Enter a valid email address.",
  "Use uma senha de 15 a 128 caracteres.": "Use a password with 15 to 128 characters.",
  "E-mail ou senha incorretos.": "Incorrect email or password.",
  "Entre novamente para continuar.": "Sign in again to continue.",
  "Muitas tentativas. Aguarde alguns minutos e tente novamente.": "Too many attempts. Wait a few minutes and try again.",
  "Recarregue a página antes de tentar novamente.": "Reload the page before trying again.",
  "Não foi possível acessar sua conta. Tente novamente.": "Your account could not be accessed. Please try again.",
  "Não foi possível exportar o rascunho. Seus dados continuam neste navegador.": "The draft could not be exported. Your data is still in this browser.",
  "Encontramos um workspace da prévia neste navegador. Exporte um ZIP e importe na sua conta para continuar com ele.": "We found a preview workspace in this browser. Export a ZIP and import it into your account to keep working on it.",
  "Exportar rascunho: {0}": "Export draft: {0}",
  "As senhas não coincidem.": "Passwords do not match.",
  "Crie sua conta Joinlet": "Create your Joinlet account",
  "Entre com e-mail e senha para salvar seu workspace online.": "Sign in with your email and password to save your workspace online.",
  "Entrar na conta": "Sign in to your account",
  "Criar conta": "Create account",
  "E-mail": "Email",
  "Senha": "Password",
  "Confirmar senha": "Confirm password",
  "Use de 15 a 128 caracteres. Guarde sua senha: a recuperação por e-mail ainda não está disponível.": "Use 15 to 128 characters. Keep your password safe: email recovery is not available yet.",
  "Aguarde…": "Please wait…",
  "Entrar": "Sign in",
  "Criar uma conta": "Create an account",
  "Já tenho uma conta": "I already have an account",
  "Trocar senha": "Change password",
  "Senha atual": "Current password",
  "Nova senha": "New password",
  "Trocar a senha encerra suas sessões. Você precisará entrar novamente.": "Changing your password ends your sessions. You will need to sign in again.",
  "Salvar nova senha": "Save new password"
};

export function authText(source: string, values?: readonly unknown[]): string {
  const template = getLocale() === 'en' ? english[source] ?? uiText(source) : source;
  return values ? template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)]) : token) : template;
}
