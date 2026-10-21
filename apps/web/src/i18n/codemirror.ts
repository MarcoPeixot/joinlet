import { EditorState } from '@codemirror/state';
import { getLocale } from './index';
export const editorLanguage = EditorState.phrases.of(getLocale() === 'en' ? {} : {
  'Control character': 'Caractere de controle', 'Completions': 'Sugestões', 'Diagnostics': 'Diagnósticos', 'No diagnostics': 'Nenhum diagnóstico',
  'Find': 'Buscar', 'Replace': 'Substituir', 'Replace all': 'Substituir tudo', 'next': 'próximo', 'previous': 'anterior', 'all': 'todos',
  'match case': 'diferenciar maiúsculas', 'by word': 'palavra inteira', 'regexp': 'expressão regular', 'replace': 'substituir', 'replace all': 'substituir tudo',
  'Go to line': 'Ir para a linha', 'go': 'ir', 'close': 'fechar', 'current match': 'ocorrência atual', 'on line': 'na linha',
  'replaced $ matches': '$ ocorrências substituídas', 'replaced match on line $': 'ocorrência substituída na linha $',
});
