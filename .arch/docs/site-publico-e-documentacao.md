# Site público e documentação

A landing em apps/web/src/landing/ apresenta o produto, a demonstração interativa, recursos, agentes e perguntas. O GitHub do produto é https://github.com/MarcoPeixot/joinlet: o cabeçalho desktop mostra o ícone, o menu mobile oferece ícone e texto, e o rodapé mantém um link visível. A URL compartilhada fica em apps/web/src/brand/project.json; o ícone usa a marca Simple Icons já presente no projeto.

Os guias em inglês e português ficam em apps/web/docs/content.json. O gerador apps/web/docs/site.mjs produz HTML estático, busca local, índice de títulos, sitemap e alternância de idioma no mesmo guia. Menu e paginação anterior/próximo seguem a mesma ordem de grupos. Links para o GitHub aparecem no cabeçalho e rodapé; o rodapé também oferece acesso ao editor com o idioma do guia em qualquer viewport.

A introdução aponta para código, issues e contribuição. A instalação local inclui clone, dependências fixadas pelo lockfile e inicialização. Requer Bun 1.4.3 ou posterior e Node.js 22.12 ou posterior para o frontend. As páginas diretas e seus links continuam disponíveis sem JavaScript.

Validação: testes dos links internos e âncoras em ambos os idiomas; regressão da ordem dos guias; Playwright para landing, busca, idioma, temas, acessibilidade e layouts de 320 a 1440 pixels. O código fica no checkout do produto, sem publicar ou alterar a visibilidade dos repositórios.

Não há fontes/importadores configurados neste workspace. As evidências ancoram arquivos reais; sync e verify não comprovam equivalência semântica de todo o frontend.
