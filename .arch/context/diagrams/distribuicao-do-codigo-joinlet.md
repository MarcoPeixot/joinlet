# Distribuição do código Joinlet

> Parte da arquitetura de “Joinlet” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.

`.arch/diagrams/distribuicao-do-codigo-joinlet.strukt.json` · 5 componentes, 4 conexões

```json
{
  "$schema": "./strukt.schema.json",
  "version": 1,
  "style": {
    "direction": "down",
    "styleMode": "plain"
  },
  "nodes": [
    {
      "id": "Product",
      "label": "Código do produto",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "code",
      "description": "Produto completo AGPL-3.0-only: editor, servidores, CLI, MCP, extensão, testes e implantação genérica, sem edição proprietária reservada."
    },
    {
      "id": "Operations",
      "label": "Operação privada",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "lock",
      "description": "Runbooks, decisões comerciais e materiais internos. Não contém credenciais reais nem dados de clientes."
    },
    {
      "id": "Deployment",
      "label": "Runtime do operador",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "server",
      "description": "Executa a release revisada com domínios e credenciais próprios. O diagrama não comprova uma instalação publicada."
    },
    {
      "id": "Configuration",
      "label": "Configuração e dados privados",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "database",
      "description": "Variáveis de ambiente, SQLite, backups e logs; ficam fora dos dois repositórios."
    },
    {
      "id": "Checks",
      "label": "Limites de publicação",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "shield",
      "description": "Git index sem arquivos privados; scan do histórico e checkout, testes e evidências."
    }
  ],
  "connections": [
    {
      "from": "Product",
      "to": "Deployment",
      "label": "build da release"
    },
    {
      "from": "Operations",
      "to": "Deployment",
      "label": "procedimentos e SHA"
    },
    {
      "from": "Configuration",
      "to": "Deployment",
      "label": "somente runtime"
    },
    {
      "from": "Checks",
      "to": "Product",
      "label": "revisão antes da publicação"
    }
  ]
}
```

## Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Código do produto (`Product`) | nó | — | Produto completo AGPL-3.0-only: editor, servidores, CLI, MCP, extensão, testes e implantação genérica, sem edição proprietária reservada. | — |
| Operação privada (`Operations`) | nó | — | Runbooks, decisões comerciais e materiais internos. Não contém credenciais reais nem dados de clientes. | — |
| Runtime do operador (`Deployment`) | nó | — | Executa a release revisada com domínios e credenciais próprios. O diagrama não comprova uma instalação publicada. | — |
| Configuração e dados privados (`Configuration`) | nó | — | Variáveis de ambiente, SQLite, backups e logs; ficam fora dos dois repositórios. | — |
| Limites de publicação (`Checks`) | nó | — | Git index sem arquivos privados; scan do histórico e checkout, testes e evidências. | — |

## Evidências no código

- `Checks`: `scripts/check-publication.py#L2` — trecho esperado: `Reject runtime/private files`
- `Checks`: `scripts/check-secrets.py#L2` — trecho esperado: `without trusting repository-provided suppressions`
- `Checks`: `scripts/test_secret_scanner.py#L1` — trecho esperado: `Integration regression`
- `Deployment`: `deploy/compose.yml#L1` — trecho esperado: `name: joinlet`
- `Product`: `package.json#L2` — trecho esperado: `joinlet`

## Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Product` | `Deployment` | `>` seta | build da release |
| `Operations` | `Deployment` | `>` seta | procedimentos e SHA |
| `Configuration` | `Deployment` | `>` seta | somente runtime |
| `Checks` | `Product` | `>` seta | revisão antes da publicação |
