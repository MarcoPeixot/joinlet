# Confiabilidade, análise sintática e onboarding

O Joinlet extrai declarações sintáticas com Tree-sitter WebAssembly nos processos locais, CLI/MCP e worker hospedado. Os assets são locais, verificados por SHA-256 e acompanham conectores e imagem; não são carregados no frontend nem baixados durante a análise. O manifesto registra versão, integridade dos pacotes e avisos das gramáticas. Fontes analisadas nunca são executadas.

## Cobertura

JavaScript/JSX, TypeScript/TSX, Python, Java, Go, Rust, Ruby, PHP, C#, F#, C, C++, Swift, Kotlin, Scala, Vue, Svelte e Astro têm extração sintática. Componentes web contribuem apenas scripts e frontmatter, com linhas originais. Comentários e strings de exemplo não estabelecem dependências. Uso de tipos e desenvolvimento fica separado do mapa principal. Namespaces, destinos ambíguos, expressões dinâmicas e erros são explicitados no documento; não há resolução completa de compiladores, instalação de dependências, expansão de macros ou comprovação de topologia implantada. A identidade dos módulos mantém os caminhos legados; manifestos de compiladores ajudam na resolução sem redefinir esses IDs. Loaders vinculados a funções/parâmetros locais são omitidos com limitação explícita quando a identidade do carregador não pode ser comprovada. Frontmatter incompleto e linguagens de script não suportadas também geram limitações. A cobertura semântica permanece parcial.

## Evidências e diagnósticos

Descrições geradas pela IA devem citar fontes do módulo descrito. Dependências externas exigem sua declaração comprovada. Evidências válidas de outro módulo produzem propostas para revisão; referências inventadas são recusadas. Referências de descrições geradas são persistidas e revalidadas, sem sobrescrever personalizações humanas. A revisão de propostas confere novamente fontes, a identidade da proposta persistida e a revisão antes do lote CAS. Propostas já resolvidas, substituídas ou analisadas em revisão anterior exigem atualizar a análise.

Com IA desabilitada, a existência e identidade do provider não alteram o estado esperado. Diagnósticos não chamam IA nem substituem a identidade da análise concluída. A versão do extrator permite atualização explícita da base; sincronizações seguintes são idempotentes. Eventos atrasados de filesystem não reiniciam a análise quando a revisão é a mesma, e gravações próprias são comparadas ao conteúdo esperado.

## Jornada pessoal

O progresso v2 pertence ao workspace no navegador e funciona sem analytics. Preferências de ocultar/recolher são migradas; conclusões legadas por clique não são provas. Repositórios oferecem conectar, explorar mapa, abrir trecho ancorado, revisar a análise e confirmar gravação. Exploração, evidência e revisão acompanham a revisão analisada. Workspaces livres oferecem edição, documentação, versão e exportação ZIP; convidados recebem passos compatíveis com suas permissões. IA e GitHub são opcionais e dependem de sucesso. Respostas tardias de outro workspace ou revisão são ignoradas. Uma exportação confirma a geração e solicitação de download, não a gravação final no disco.

## Verificação

O comando padrão executa workspaces sequencialmente. As entradas adversariais continuam na suíte funcional; o job de desempenho usa aquecimento e mediana de três execuções, separado de build e tipos. O executor reserva até 20 segundos por caso nesse job para comportar o aquecimento e as três execuções no Linux; os limites das medianas individuais permanecem os originais, sem retries. Links locais de Markdown e imagens são conferidos, respeitando a origem das projeções importadas. O teste de produção mede também imports dinâmicos e workers, com orçamento de 2.700.000 bytes JavaScript descomprimidos e 55 requisições na abertura nova do exemplo. Recursos de código e documentos são carregados ao uso. Ícones comuns têm um subconjunto inicial; os catálogos completos continuam disponíveis. O painel Código preserva sua preferência de abertura. Os guias públicos PT-BR/EN descrevem o catálogo de múltiplos workspaces; a prévia sem conta continua com um workspace local.

A validação de produção local desta entrega mediu 2.311.994 bytes de JavaScript descomprimidos em 54 requisições, no exemplo padrão, com armazenamento novo e cache desabilitado. Não é uma medição da instalação oficial. A suíte padrão passou com 4.326 testes; o comando de desempenho separado também passou. As 22 sondas sintáticas (extensões e componentes) foram executadas em Node e Bun. O teste de navegador cobre ainda restauração do painel Código e analytics com consentimento aceito/recusado.

A validação também executou 42 cenários no navegador (incluindo jornada de repositório, troca de workspace, permissões e gravação), as sondas dos parsers na imagem Docker e no conector compilado macOS arm64, e o fluxo real de pareamento/sincronização/reinício/revogação desse conector. Os cinco alvos de conectores foram compilados com assets, licenças e hashes verificados; os demais alvos não foram executados nativamente.

As verificações locais e os testes controlados não comprovam implantação oficial nem qualidade semântica universal.
