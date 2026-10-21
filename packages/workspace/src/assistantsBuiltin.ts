import type { Assistant } from './assistants';

/** The assistants every workspace has. Kept apart from `assistants.ts` (which loading a workspace needs) so only the chat pays for these texts. */
export const BUILTIN_ASSISTANTS: readonly Assistant[] = [
  {
    id: 'builtin-spof',
    name: 'Revisar pontos únicos de falha',
    scope: 'diagram',
    instruction:
      'Revise o diagrama aberto à procura de pontos únicos de falha. Para cada ponto, cite o componente com [[Id]], explique em uma frase o que para de funcionar se ele cair, diga o que depende dele e proponha uma mitigação concreta (réplica, fila, cache, failover, timeout, circuit breaker). Separe em "Críticos" e "Atenção", do mais grave ao menos grave. Termine listando o que o diagrama não mostra e impede uma conclusão (por exemplo, se o banco tem réplica ou se há mais de uma instância). Se não houver pontos únicos de falha evidentes, diga isso e por quê.',
  },
  {
    id: 'builtin-security',
    name: 'Auditar segurança',
    scope: 'workspace',
    instruction:
      'Faça uma auditoria de segurança da arquitetura descrita nos diagramas e documentos. Procure: componentes expostos à internet, fronteiras de confiança sem autenticação ou autorização visível, dados sensíveis guardados ou trafegando sem cifragem indicada, segredos e credenciais, permissões amplas entre serviços, falta de registro de auditoria e dependências de terceiros. Para cada achado dê a severidade (Alta, Média ou Baixa), o componente citado com [[Id]] (ou [[slug#Id]] em outro diagrama), o risco e a correção recomendada. Separe o que o desenho mostra do que você está supondo e liste perguntas para o time sobre o que não dá para saber.',
  },
  {
    id: 'builtin-changes',
    name: 'Resumir mudanças desde a última versão',
    scope: 'diagram',
    changes: true,
    instruction:
      'Resuma as mudanças feitas neste diagrama desde a última versão salva, usando a seção "Mudanças desde a última versão salva" do contexto. Agrupe em Adicionado, Removido, Alterado e Conexões; cite os componentes com [[Id]]; explique em linguagem de arquitetura o que cada mudança significa (não repita as operações) e destaque os riscos ou perguntas que a mudança levanta. Se não houver mudanças, diga isso em uma frase.',
  },
  {
    id: 'builtin-adr',
    name: 'Rascunhar ADR',
    scope: 'workspace',
    instruction:
      'Rascunhe um ADR (registro de decisão de arquitetura) em Markdown a partir do diagrama aberto e dos documentos. Use as seções: Título (com número a definir), Status (Proposta), Contexto, Decisão, Alternativas consideradas, Consequências (positivas e negativas) e Pontos em aberto. Cite os componentes com [[Id]] (ou [[slug#Id]] em outro diagrama). Se a decisão não estiver clara, escolha a mais provável pelo desenho, marque como suposição e liste o que precisa ser confirmado. Responda só com o ADR.',
  },
];

/** The built-ins first, then the workspace's own. */
export const allAssistants = (saved: readonly Assistant[] | undefined): Assistant[] => [...BUILTIN_ASSISTANTS, ...(saved ?? [])];
