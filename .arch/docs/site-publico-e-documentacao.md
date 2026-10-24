# Site público e documentação

A landing em apps/web/src/landing/ apresenta o produto, a demonstração interativa, recursos, agentes e perguntas. O GitHub do produto é https://github.com/MarcoPeixot/joinlet: o cabeçalho desktop mostra o ícone, o menu mobile oferece ícone e texto, e o rodapé mantém um link visível. A URL compartilhada fica em apps/web/src/brand/project.json; o ícone usa a marca Simple Icons já presente no projeto.

Os guias em inglês e português ficam em apps/web/docs/content.json. O gerador apps/web/docs/site.mjs produz HTML estático, busca local, índice de títulos, sitemap e alternância de idioma no mesmo guia. Menu e paginação anterior/próximo seguem a mesma ordem de grupos. Links para o GitHub aparecem no cabeçalho e rodapé; o rodapé também oferece acesso ao editor com o idioma do guia em qualquer viewport.

A introdução aponta para código, issues e contribuição. A instalação local inclui clone, dependências fixadas pelo lockfile e inicialização. Requer Bun 1.4.3 ou posterior e Node.js 22.12 ou posterior para o frontend. As páginas diretas e seus links continuam disponíveis sem JavaScript.

Validação: testes dos links internos e âncoras em ambos os idiomas; regressão da ordem dos guias; Playwright para landing, busca, idioma, temas, acessibilidade e layouts de 320 a 1440 pixels. O código fica no checkout do produto, sem publicar ou alterar a visibilidade dos repositórios.

Não há fontes/importadores configurados neste workspace. As evidências ancoram arquivos reais; sync e verify não comprovam equivalência semântica de todo o frontend.

## Padrões visuais e disponibilidade da IA

Landing, editor, documentação e guia de instalação iniciam em tema escuro; o idioma padrão é inglês. Preferências explícitas de tema claro, contraste, sistema e português continuam válidas. O tema é aplicado antes da primeira pintura, inclusive quando o armazenamento está bloqueado. A documentação usa o idioma de sua URL.

O modo browser-preview oferece edição e armazenamento no navegador, sem serviço de IA. Configurações informa esse limite diretamente, apresenta clone e instalação local com lockfile e mantém a exportação ZIP como caminho para transferir o workspace ao editor local. Não solicita /api/settings nem oferece tentativas de reconexão para um serviço deliberadamente desabilitado. A execução local mantém o formulário e o teste dos provedores; hosted autenticado continua separado e exige serviço e sessão autorizados.

Diagnóstico da publicação em 22/10/2026: app.joinlet.co servia a meta browser-preview e respondia HTTP 503 em /api/settings com Online services are not available in this browser preview. A API local consultada respondeu HTTP 200; isso comprova disponibilidade de configuração, sem testar chaves ou gerar consumo em provedores. Iniciar a API local não conecta automaticamente a página hospedada a ela: é preciso abrir o editor local.

Os testes de navegador verificam os padrões em um sistema operacional claro, preferências preservadas, a orientação de IA na prévia e os fluxos locais de conectar, trocar modelos e testar provedores com credenciais simuladas.


O menu mobile ocupa a altura disponível da viewport e mantém todos os links, incluindo GitHub, acessíveis antes e depois de rolar a página. Enquanto o diálogo de navegação está aberto, o cabeçalho remove seu filtro de fundo para não limitar o elemento fixo à altura do cabeçalho. O teste de navegador confere a geometria, a interseção dos links e a possibilidade de clicar no GitHub.

## Métricas opcionais nos guias

O build gera uma entrada enxuta para consentimento e eventos dos guias, além de CSS próprio. Sem a meta do operador, essa entrada não consulta o coletor nem exibe consentimento. Quando habilitada, usa a mesma preferência v2 da landing/editor e envia somente o identificador conhecido do guia e a posição fixa dos links para experimentar. Consultas de busca e texto dos guias não entram nos eventos. O protocolo e os limites de ativação estão em Analytics opcional do Joinlet.

## Entrada por senha no backend hospedável

Quando o operador ativa o modo remoto, o editor apresenta cadastro e entrada por e-mail/senha; GitHub aparece somente com suas duas credenciais configuradas. O cadastro informa que recuperação por e-mail ainda não está disponível. Troca de senha fica nas configurações da conta. Rascunhos válidos ou danificados da prévia podem ser exportados na tela de login, antes de entrar, sem alterar o IndexedDB original. A transferência ao workspace Cloud ocorre por importação ZIP confirmada. Os testes em navegador cobrem cadastro, erro de confirmação, entrada em outro perfil, persistência, troca de senha, invalidação de sessões, logout e exportação do rascunho.

A configuração JOINLET_ANALYTICS_PATH=/telemetry injeta as metas de métricas consentidas no HTML remoto. Sem essa configuração, a coleta permanece desativada. O Caddy/serviço coletor é responsabilidade do operador.

## Pausa de contas no modo de navegador

O modo browser-preview abre um workspace salvo neste navegador sem consultar a sessão remota. Login, cadastro e workspaces adicionais ficam desabilitados nessa modalidade; atingir o limite exibe Um workspace por enquanto, sem formulário ou link de autenticação. Edição e exportação continuam disponíveis. Isso não migra nem expõe dados de contas hospedadas existentes. Operadores devem também bloquear as rotas públicas de conta no proxy ao pausar o serviço; a meta do cliente não é uma autorização para acessar o backend. O modo remoto configurado e self-hosted mantêm seus controles próprios.
