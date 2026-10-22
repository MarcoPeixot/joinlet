# Publicação do Joinlet

A configuração de exemplo usa a landing e os guias em **joinlet.co**. e o aplicativo em **app.joinlet.co**, com login, API, convites, colaboração WebSocket e MCP no mesmo host. Não é necessário comprar outro domínio. Os dois hosts compartilham inicialmente o serviço remoto e seu volume persistente; esta separação não oferece disponibilidade independente.

1. Copie `.env.production.example` para `.env.production` nesta pasta e preencha as credenciais, contato ACME e chave de criptografia estável.
2. Configure DNS para `joinlet.co` e `app.joinlet.co` apontando para o servidor do Caddy. Publique AAAA somente se o host tiver IPv6 funcional. Libere portas 80/443.
3. Mantenha as quatro configurações coerentes:

```dotenv
JOINLET_DOMAIN=joinlet.co
JOINLET_APP_DOMAIN=app.joinlet.co
JOINLET_SITE_URL=https://joinlet.co
STRUKT_PUBLIC_URL=https://app.joinlet.co
```

4. O acesso por e-mail/senha funciona sem credenciais GitHub. Para habilitar GitHub e o fluxo repositório/MCP opcional, na GitHub App use `https://app.joinlet.co/github/callback` como callback OAuth e `https://joinlet.co` como homepage. Mantenha as permissões e instalações de repositórios. Em homologação, utilize uma GitHub App separada.
5. Na raiz do repositório, execute:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d --build
```

O Caddy solicita certificados para ambos os hosts. O processo aceita apenas os hosts configurados; verificações internas `/health` e `/ready` também funcionam por loopback. O app recebe `noindex`, o site não atende APIs/sessões, e cookies continuam exclusivos do host do app. Não configure cookies para `.joinlet.co` ou um proxy da API pelo domínio da landing.

Confirme a landing em `https://joinlet.co/`, os guias em `https://joinlet.co/docs/en/`, o app em `https://app.joinlet.co/`, o login e um convite real com dois navegadores. O endpoint MCP remoto é `https://app.joinlet.co/mcp`. Teste também reconexão da colaboração e recuperação do banco conforme o guia de publicação do produto. Os testes automatizados usam GitHub simulado; credenciais reais precisam ser validadas em homologação.

## Contas com senha

O backend permite cadastro e entrada por e-mail/senha, com sessão exclusiva do host do aplicativo. Senhas usam Argon2id e têm de 15 a 128 caracteres; espaços são preservados. Trocar a senha nas configurações encerra todas as sessões da conta. Nesta primeira entrega, o e-mail é um identificador sem confirmação de titularidade; recuperação por e-mail e vínculo de métodos ficam para uma próxima etapa. O editor informa esse limite no cadastro. Não configure SMTP fictício.

GitHub é opcional: preencha as duas variáveis da App para habilitá-lo, ou deixe ambas vazias. A ausência dessas credenciais não impede iniciar o backend com senha. IDs internos de conta e IDs GitHub são distintos; contas por senha não recebem administração por coincidência de números.

Depois de restaurar um snapshot em ambiente isolado, antes de expô-lo, execute `bun apps/remote/src/recovery.ts /caminho/restaurado.sqlite --invalidate-access`. O comando invalida sessões, autorizações e convites que poderiam ter sido revogados depois do backup, preservando workspaces e configurações criptografadas. Mantenha a mesma chave de criptografia.

## Migração de uma instalação existente

Ao substituir a prévia pelo login na mesma origem, a tela de entrada oferece exportação ZIP dos rascunhos existentes em IndexedDB, sem apagá-los. Exporte antes de entrar e importe no workspace online após o login. Antes de mudar de origem, exporte em ZIP os projetos que vivem somente no navegador no endereço antigo e importe-os no novo app. Armazenamento IndexedDB/localStorage e permissões de pastas pertencem à origem e não migram automaticamente. Preserve banco SQLite, volume `/data`, chave de criptografia e backups. Contas Cloud mantêm os dados no servidor, mas será necessário entrar novamente no novo host. Não execute `down -v`.

Links antigos `/app/?...` redirecionam para a raiz do app preservando parâmetros. Convites antigos `/join/...` e login web também seguem para o app. Atualize configurações de clientes MCP: requisições de API, registro OAuth e descoberta MCP não são redirecionadas pelo site público.

Sem `JOINLET_SITE_URL`, o servidor conserva o modo combinado: landing `/`, editor `/app/`. A configuração local de desenvolvimento permanece igual. O servidor injeta os endereços nos HTMLs da landing, app e documentação, permitindo usar o mesmo build em homologação e produção. Uma hospedagem puramente estática precisa implementar essas rotas e links explicitamente.

## Política de instalação

O exemplo e o entrypoint remoto usam `JOINLET_DEPLOYMENT_MODE=self-hosted` por padrão, sem cotas comerciais de workspaces, diagramas ou participantes. Troque domínios e credenciais pelos seus. `cloud` seleciona a política Beta para uma operação gerenciada; não concede acesso à infraestrutura oficial. A operação oficial deve definir esse valor explicitamente no ambiente privado.

Capacidade continua limitada pelo host, por uma réplica por workspace, pelo workspace pessoal persistente único por conta no backend atual e pelos limites técnicos de arquivos/requisições/armazenamento. Autenticação, papéis e isolamento continuam ativos. Este exemplo não comprova uma instalação oficial já publicada. Veja [o modelo aberto](../docs/open-source.md) e [a promoção de releases](../docs/releases.md).
