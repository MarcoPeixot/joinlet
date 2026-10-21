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

4. Na GitHub App, use `https://app.joinlet.co/github/callback` como callback OAuth e `https://joinlet.co` como homepage. Mantenha as permissões e instalações de repositórios. Em homologação, utilize uma GitHub App separada.
5. Na raiz do repositório, execute:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d --build
```

O Caddy solicita certificados para ambos os hosts. O processo aceita apenas os hosts configurados; verificações internas `/health` e `/ready` também funcionam por loopback. O app recebe `noindex`, o site não atende APIs/sessões, e cookies continuam exclusivos do host do app. Não configure cookies para `.joinlet.co` ou um proxy da API pelo domínio da landing.

Confirme a landing em `https://joinlet.co/`, os guias em `https://joinlet.co/docs/en/`, o app em `https://app.joinlet.co/`, o login e um convite real com dois navegadores. O endpoint MCP remoto é `https://app.joinlet.co/mcp`. Teste também reconexão da colaboração e recuperação do banco conforme o guia de publicação do produto. Os testes automatizados usam GitHub simulado; credenciais reais precisam ser validadas em homologação.

## Migração de uma instalação existente

Antes da troca, exporte em ZIP os projetos que vivem somente no navegador no endereço antigo e importe-os no novo app. Armazenamento IndexedDB/localStorage e permissões de pastas pertencem à origem e não migram automaticamente. Preserve banco SQLite, volume `/data`, chave de criptografia e backups. Contas Cloud mantêm os dados no servidor, mas será necessário entrar novamente no novo host. Não execute `down -v`.

Links antigos `/app/?...` redirecionam para a raiz do app preservando parâmetros. Convites antigos `/join/...` e login web também seguem para o app. Atualize configurações de clientes MCP: requisições de API, registro OAuth e descoberta MCP não são redirecionadas pelo site público.

Sem `JOINLET_SITE_URL`, o servidor conserva o modo combinado: landing `/`, editor `/app/`. A configuração local de desenvolvimento permanece igual. O servidor injeta os endereços nos HTMLs da landing, app e documentação, permitindo usar o mesmo build em homologação e produção. Uma hospedagem puramente estática precisa implementar essas rotas e links explicitamente.

## Política de instalação

O exemplo e o entrypoint remoto usam `JOINLET_DEPLOYMENT_MODE=self-hosted` por padrão, sem cotas comerciais de workspaces, diagramas ou participantes. Troque domínios e credenciais pelos seus. `cloud` seleciona a política Beta para uma operação gerenciada; não concede acesso à infraestrutura oficial. A operação oficial deve definir esse valor explicitamente no ambiente privado.

Capacidade continua limitada pelo host, por uma réplica por workspace, pelo workspace pessoal persistente único por conta no backend atual e pelos limites técnicos de arquivos/requisições/armazenamento. Autenticação, papéis e isolamento continuam ativos. Este exemplo não comprova uma instalação oficial já publicada. Veja [o modelo aberto](../docs/open-source.md) e [a promoção de releases](../docs/releases.md).
