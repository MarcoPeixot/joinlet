# Fluxo de release proposto

> Parte da arquitetura de “Joinlet” (visão completa em [ARCHITECTURE.md](../ARCHITECTURE.md)). Gerado pelo Joinlet: não edite à mão.

`.arch/diagrams/fluxo-de-release-proposto.strukt.json` · 9 componentes, 9 conexões

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
      "id": "Contribution",
      "label": "Contribuição",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "users",
      "description": "Pessoa propõe uma mudança no repositório do produto."
    },
    {
      "id": "PR",
      "label": "Pull request",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "git-pull-request",
      "description": "Mudança revisável; contribuidores não recebem credenciais de produção."
    },
    {
      "id": "CI",
      "label": "CI e segurança",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "shield",
      "description": "Implementado: tipos, build, testes, arquitetura, navegador, container e fronteiras de publicação."
    },
    {
      "id": "Main",
      "label": "Commit revisado em main",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "git-branch",
      "description": "Escolher revisão completa cujos checks obrigatórios passaram; proteção depende das regras habilitadas."
    },
    {
      "id": "Image",
      "label": "Imagem de release",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "package",
      "description": "Proposto: build uma vez a partir de git archive, atestar procedência e registrar digest imutável."
    },
    {
      "id": "Staging",
      "label": "Homologação",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "flask-conical",
      "description": "Proposto: testar o mesmo digest com credenciais e dados separados."
    },
    {
      "id": "Approval",
      "label": "Aprovação do operador",
      "presentation": "card",
      "layoutRole": "peer",
      "icon": "check",
      "description": "Proposto: decisão explícita de promover o artefato validado."
    },
    {
      "id": "Official",
      "label": "Joinlet oficial",
      "presentation": "card",
      "layoutRole": "shared",
      "icon": "server",
      "description": "Proposto: executar a release aprovada com volume e segredos privados. Este diagrama não comprova um deploy."
    },
    {
      "id": "Operations",
      "label": "Registro privado de release",
      "presentation": "card",
      "layoutRole": "entry",
      "icon": "lock",
      "description": "Proposto: SHA, digest, evidências de validação e caminho de rollback, sem duplicar código."
    }
  ],
  "connections": [
    {
      "from": "Contribution",
      "to": "PR"
    },
    {
      "from": "PR",
      "to": "CI"
    },
    {
      "from": "CI",
      "to": "Main"
    },
    {
      "from": "Main",
      "to": "Image"
    },
    {
      "from": "Image",
      "to": "Staging"
    },
    {
      "from": "Staging",
      "to": "Approval"
    },
    {
      "from": "Approval",
      "to": "Official"
    },
    {
      "from": "Operations",
      "to": "Approval"
    },
    {
      "from": "Operations",
      "to": "Official"
    }
  ]
}
```

## Componentes

| Componente | Tipo | Tecnologia | Descrição | Grupo |
| --- | --- | --- | --- | --- |
| Contribuição (`Contribution`) | nó | — | Pessoa propõe uma mudança no repositório do produto. | — |
| Pull request (`PR`) | nó | — | Mudança revisável; contribuidores não recebem credenciais de produção. | — |
| CI e segurança (`CI`) | nó | — | Implementado: tipos, build, testes, arquitetura, navegador, container e fronteiras de publicação. | — |
| Commit revisado em main (`Main`) | nó | — | Escolher revisão completa cujos checks obrigatórios passaram; proteção depende das regras habilitadas. | — |
| Imagem de release (`Image`) | nó | — | Proposto: build uma vez a partir de git archive, atestar procedência e registrar digest imutável. | — |
| Homologação (`Staging`) | nó | — | Proposto: testar o mesmo digest com credenciais e dados separados. | — |
| Aprovação do operador (`Approval`) | nó | — | Proposto: decisão explícita de promover o artefato validado. | — |
| Joinlet oficial (`Official`) | nó | — | Proposto: executar a release aprovada com volume e segredos privados. Este diagrama não comprova um deploy. | — |
| Registro privado de release (`Operations`) | nó | — | Proposto: SHA, digest, evidências de validação e caminho de rollback, sem duplicar código. | — |

## Conexões

| De | Para | Tipo | Rótulo |
| --- | --- | --- | --- |
| `Contribution` | `PR` | `>` seta | — |
| `PR` | `CI` | `>` seta | — |
| `CI` | `Main` | `>` seta | — |
| `Main` | `Image` | `>` seta | — |
| `Image` | `Staging` | `>` seta | — |
| `Staging` | `Approval` | `>` seta | — |
| `Approval` | `Official` | `>` seta | — |
| `Operations` | `Approval` | `>` seta | — |
| `Operations` | `Official` | `>` seta | — |
