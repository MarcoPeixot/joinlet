# Ícones oficiais de arquitetura cloud

Importado em **2026-10-03**. Os SVG distribuídos pelo Joinlet são derivados dos pacotes oficiais abaixo para uso em diagramas, documentação técnica e materiais de arquitetura. São ativos de marca dos provedores; não estão sendo relicenciados como MIT ou CC0.

## Fontes e uso

- **AWS:** [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) permite clientes e parceiros usarem os ativos em diagramas e materiais técnicos. Pacote `Asset-Package_07312025`: [ZIP oficial](https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/architecture/approved/architecture-icons/Asset-Package_07312025.49d3aab7f9e6131e51ade8f7c6c8b961ee7d3bb1.zip). Foram incluídos serviços (64 px), recursos (48 px), categorias e marcadores de fronteira, deduplicando resoluções; 49 variantes escuras oficiais são mantidas para alternância de tema.
- **Microsoft Azure:** [Azure Architecture Icons e termos](https://learn.microsoft.com/en-us/azure/architecture/icons/) permite cópia, distribuição e exibição para diagramas de arquitetura, documentação e treinamento. Preservar a forma, proporções e orientação; usar o nome do produto próximo do ícone. Não usar para representar o próprio produto. Pacote [Azure Public Service Icons V24](https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip), incluindo `Microsoft_Terms_of_Use.pdf` e `Azure_Icons_FAQ.pdf` no arquivo oficial.
- **Microsoft Entra:** [ícones e termos oficiais](https://learn.microsoft.com/en-us/entra/architecture/architecture-icons). As mesmas condições de uso técnico se aplicam; a página também exclui comunicações de marketing. Pacote [October 2023](https://download.microsoft.com/download/3/1/a/31a56038-856a-4489-88e4-ee5a1c4352be/Microsoft%20Entra%20architecture%20icons%20-%20Oct%202023.zip). Apenas as versões coloridas de produtos foram incorporadas à categoria Azure.
- **Google Cloud:** [biblioteca oficial](https://cloud.google.com/icons) disponibiliza os ícones para diagramas e documentação. Pacotes [Core product icons](https://services.google.com/fh/files/misc/core-products-icons.zip), [Product category icons](https://services.google.com/fh/files/misc/category-icons.zip) e [Legacy console icons](https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip). Os ícones de produtos atualizados substituem seus equivalentes antigos; os demais mantêm o desenho legacy oficial, identificado nos metadados.

Os nomes, marcas e direitos dos ativos permanecem com Amazon Web Services, Microsoft e Google. Este catálogo não sugere afiliação ou endosso do Joinlet.

## Conteúdo e renderização

O catálogo possui **1.712 ícones**: AWS **821**, Azure/Entra **640** e Google Cloud **251**. Há **1.648 presets de serviços e recursos**, mais **13 grupos de fronteira AWS** (cloud, conta, região, VPC e sub-redes). Categorias e marcadores também estão disponíveis no seletor de ícones. Nomes persistidos usam namespaces `aws:`, `azure:` e `gcp:`; nomes antigos do registro continuam compatíveis.

`packages/core/src/cloudIcons.json` fornece nomes, rótulos, família, provedor e indicação legacy. O subpath `@strukt/core/cloud` expõe esses metadados e presets sem carregá-los pelo entry principal do core; no navegador, eles entram apenas ao abrir a biblioteca ou o seletor de ícones. Os corpos SVG são carregados sob demanda por provedor em `apps/web/src/diagram/icons/cloud/`. Todos os SVG preservam `viewBox`, proporções, preenchimentos e gradientes. As variantes escuras oficiais da AWS são selecionadas no tema escuro, inclusive na exportação SVG. O importador permite apenas elementos/atributos SVG passivos, converte classes CSS em atributos e elimina estilos globais, títulos e metadados de geração. Referências de gradientes, máscaras e recortes são prefixadas por ícone durante a renderização, para evitar colisões no canvas e na exportação.

Para regenerar, extraia cada ZIP para um diretório com subpastas `aws`, `azure`, `entra`, `gcp`, `gcp-categories` e `gcp-legacy`, então execute:

```sh
python3 apps/web/scripts/build-cloud-icons.py /caminho/para/os/pacotes
```

Não há download automático na aplicação. Atualizações dos ativos passam por importação e validação antes de entrar no catálogo.

## Integridade dos pacotes importados

| Pacote | SHA-256 |
| --- | --- |
| AWS | `48b30cb487fb0c97a5c239312290aeeac3e0bcc75409f552604f1ac03e866c1e` |
| Azure | `921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141` |
| Entra | `4e07536706a2d092e6524e5417e2c861333fdbdb41c36f78d44dfa07ccc5eedc` |
| GCP core | `6531a10f58bc599c24d9a455d81dd757c1a03c3c43da9cddf639b859c1c1eece` |
| GCP categorias | `e5bc3abd3527dc2500e9bff7f15870783e2c764129c49b7cd4c1b4e105345002` |
| GCP legacy | `a6d9d7921758042538b462f03cf64614c2cebd96743b3ed63580a769fc7de3e9` |
