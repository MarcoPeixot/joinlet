import { parseStage } from '@strukt/workspace';

export const COMMANDS = ['init', 'connect', 'watch', 'verify', 'context', 'check', 'evidence', 'diff', 'list', 'export', 'site', 'publish', 'pr-comment', 'sync', 'sources', 'import'] as const;
export type Command = (typeof COMMANDS)[number] | 'help';

export interface CliArgs {
  command: Command;
  /** Where to look for `.arch/`; the search walks up from here. */
  dir: string;
  /** `context`: output directory, relative to the workspace root (inside `.arch/`). `export`: output file (stdout by default). `site`: output directory (default `./strukt-site`). */
  out?: string;
  /** `context` only: fail (exit 1) when the generated files would change. */
  check: boolean;
  /** `check`/`diff`: machine-readable output. */
  json: boolean;
  /** `check` only: also compare evidence with the repository files (moved/changed snippets, missing lines). */
  drift: boolean;
  /** `check` only: drift findings fail (exit 1) instead of warning. */
  strict: boolean;
  /** `diff` only: Markdown instead of text. */
  markdown: boolean;
  /** `diff` only: the refs to compare (0, 1 or 2). */
  refs: string[];
  /** `diff` only: compare the diagram on disk with the saved version of this stage (`atual`, `transição`/`transicao`, `planejado`) instead of git refs. */
  stage?: string;
  /** `diff` only: directory that receives one `<slug>.diff.svg` per changed diagram. */
  svg?: string;
  /** `pr-comment` only: link to the CI run holding the `strukt-diff` artifact. */
  artifactUrl?: string;
  /** `export` only: `mermaid` or `plantuml` (validated by the command). */
  format?: string;
  /** `publish` only. */
  title?: string;
  bodyFile?: string;
  branch?: string;
  base?: string;
  draft: boolean;
  /** `sources add` only. */
  kind?: string;
  include: string[];
  diagram?: string;
  mode?: string;
  /** `import cloud` / `check --cloud`: the provider CLI to read (aws, azure, gcp) and what narrows the listing. A profile is a name for the user's own CLI, never stored. */
  provider?: string;
  profile?: string;
  region?: string;
  subscription?: string;
  project?: string;
  resourceGroup?: string;
  /** `import cloud` only: a `terraform show -json` file instead of a provider. */
  file?: string;
  /** `check` only: compare the imported cloud diagrams with the live cloud (`aws|azure|gcp`) or with a `terraform show -json` file. */
  cloud?: string;
  /** `pr-comment` only. */
  pr?: string;
  head?: string;
  help: boolean;
  cloudUrl?: string;
  dirExplicit?: boolean;
  pair?: string;
}

export const USAGE = `joinlet — arquitetura do Joinlet para agentes e CI

Uso:
  joinlet <comando> [opções]

Comandos:
  init [--check] [--json]                  Inicializa .arch a partir do repositório e documentos
  connect [--cloud-url <url> --pair <code>] Abre o editor local ou conecta este computador à Cloud
  watch                                   Acompanha mudanças do código e atualiza .arch
  verify [--json] [--strict]                Verifica código vinculado, fontes, diagramas e contexto; strict exige cobertura e revisão das divergências
  context [--out .arch/context] [--check]   Gera o contexto para agentes (.arch/context/)
  check [--json] [--drift] [--strict]       Valida o manifesto e todos os diagramas; --drift compara as evidências
                                            com os arquivos do repositório (avisos; --strict transforma em erro)
  evidence snap                             Grava o trecho (snippet) das evidências com linha, para detectar deriva
  diff <ref-a> [<ref-b>] [--markdown] [--svg <pasta>]
                                            Diff semântico entre refs do git (ou worktree/HEAD); --svg grava
                                            <pasta>/<slug>.diff.svg (antes/depois visual) de cada diagrama alterado
  diff --stage atual|transição|planejado [--markdown] [--json]
                                            Diff entre o diagrama em disco e a versão salva desse estágio (a meta mais
                                            próxima, para transição/planejado), na direção do tempo
  list                                      Lista diagramas, documentos e versões
  export <slug> --format mermaid|plantuml [--out <arquivo>]
                                            Exporta um diagrama como Mermaid ou PlantUML (stdout por padrão)
  site [--out <pasta>]                      Gera o site estático da arquitetura (HTML sem JavaScript; padrão ./strukt-site)
  publish --title <título> [--body-file <f>] [--branch <b>] [--base <b>] [--draft]
                                            Cria branch + commit (só .arch/) + PR com o diff semântico
  pr-comment [--pr <n>] --base <ref> [--head <ref>] [--artifact-url <link>]
                                            Comenta (ou atualiza) o diff semântico no PR
  sync [--check] [--markdown] [--json]      Importa os arquivos das fontes (.arch/sources.json: Terraform, Kubernetes,
                                            OpenAPI, D2, Mermaid, LikeC4, Structurizr) e mescla no diagrama de destino,
                                            preservando ids, posições e anotações manuais; --check sai com 1 quando o
                                            diagrama está desatualizado em relação às fontes (deriva)
  sources list [--json]                     Lista as fontes de sincronização
  sources add <id> --kind <tipo> --include <glob> [--include <glob>…] --diagram <slug> [--mode merge|replace]
                                            Liga arquivos do repositório a um diagrama (cria o diagrama se não existir;
                                            "!padrão" exclui; use aspas nos globs)
  sources remove <id>                       Tira a fonte da lista (o diagrama e seus elementos continuam)
  import cloud --provider aws|azure|gcp [--profile <p>] [--region <r>] [--subscription <s>] [--resource-group <g>] [--project <id>] [--title <t>]
  import cloud --file <terraform-show.json> [--title <t>]
                                            Importa o estado vivo da nuvem como diagrama, usando o CLI da sua própria conta
                                            (aws/az/gcloud, só comandos de leitura da lista permitida; sem segredos) ou a
                                            saída de "terraform show -json"; registra os recursos em .arch/cloud.json
  check --cloud aws|azure|gcp|<arquivo> [--strict]
                                            Compara os diagramas importados da nuvem com o estado vivo (adicionado, removido,
                                            alterado): avisos; --strict transforma em erro

Opções:
  --dir <caminho>   Onde procurar o workspace (padrão: diretório atual; sobe até achar .arch/)
  -h, --help        Mostra esta ajuda

Saída: 0 sucesso · 1 validação falhou · 2 uso ou ambiente inválido.`;

const VALUE_FLAGS = ['--cloud-url', '--pair', '--dir', '--out', '--format', '--title', '--body-file', '--branch', '--base', '--pr', '--head', '--svg', '--artifact-url', '--stage', '--kind', '--include', '--diagram', '--mode', '--provider', '--profile', '--region', '--subscription', '--resource-group', '--project', '--file', '--cloud'] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

/** Parses the command line; unknown flags and missing values come back as a pt-BR error. */
export function parseArgs(argv: readonly string[]): CliArgs | { error: string } {
  const [command, ...rest] = argv;
  const args: CliArgs = {
    command: 'help',
    dir: process.cwd(),
    check: false,
    json: false,
    markdown: false,
    drift: false,
    strict: false,
    refs: [],
    include: [],
    draft: false,
    help: false,
  };
  if (!command || command === '-h' || command === '--help') return { ...args, help: true };
  if (!(COMMANDS as readonly string[]).includes(command)) return { error: `Comando desconhecido: "${command}".` };
  args.command = command as Command;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const equals = VALUE_FLAGS.find((flag) => arg.startsWith(`${flag}=`));
    if (equals) {
      const value = arg.slice(equals.length + 1);
      if (!value) return { error: `A opção ${equals} precisa de um valor.` };
      setValue(args, equals, value);
      continue;
    }
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = rest[++i];
      if (value === undefined || value.startsWith('-')) return { error: `A opção ${arg} precisa de um valor.` };
      setValue(args, arg as ValueFlag, value);
      continue;
    }
    if (arg === '--check') args.check = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--drift') args.drift = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg === '--draft') args.draft = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (arg.startsWith('-')) return { error: `Opção desconhecida: "${arg}".` };
    else args.refs.push(arg);
  }

  if (['init','connect','watch'].includes(args.command) && args.refs.length) {
    if(args.refs.length!==1 || args.dirExplicit)return {error:'Choose one repository folder, with a positional path or --dir.'};
    args.dir=args.refs[0]!;args.dirExplicit=true;args.refs=[];
  }
  if (args.command !== 'diff' && args.command !== 'export' && args.command !== 'evidence' && args.command !== 'sources' && args.command !== 'import' && args.refs.length) return { error: `O comando "${args.command}" não aceita argumentos posicionais.` };
  if (args.command === 'diff' && args.refs.length > 2) return { error: 'O diff compara no máximo dois refs.' };
  if (args.command === 'export' && args.refs.length !== 1) return { error: 'O export precisa de exatamente um <slug> de diagrama.' };
  if (args.command === 'evidence' && (args.refs.length !== 1 || args.refs[0] !== 'snap')) return { error: 'O evidence precisa de um subcomando: snap.' };
  if (args.command === 'sources') {
    const [action, id, ...extra] = args.refs;
    if (action !== 'list' && action !== 'add' && action !== 'remove') return { error: 'O sources precisa de um subcomando: list, add ou remove.' };
    if (action === 'list' ? id !== undefined : id === undefined || extra.length) return { error: action === 'list' ? 'O "sources list" não aceita argumentos.' : `O "sources ${action}" precisa de exatamente um <id> de fonte.` };
    if (action !== 'add' && (args.kind !== undefined || args.include.length || args.diagram !== undefined || args.mode !== undefined)) return { error: 'As opções --kind, --include, --diagram e --mode só valem para "sources add".' };
    if (action === 'add' && (!args.kind || !args.include.length || !args.diagram)) return { error: 'O "sources add" precisa de --kind, --include (ao menos um) e --diagram.' };
  } else if (args.kind !== undefined || args.include.length || args.diagram !== undefined || args.mode !== undefined) return { error: 'As opções --kind, --include, --diagram e --mode só valem para "sources add".' };
  if (args.command === 'import' && (args.refs.length !== 1 || args.refs[0] !== 'cloud')) return { error: 'O import precisa de um subcomando: cloud.' };
  const cloudFlags = [args.provider, args.profile, args.region, args.subscription, args.resourceGroup, args.project].some((value) => value !== undefined);
  if (cloudFlags && args.command !== 'import' && !(args.command === 'check' && args.cloud !== undefined)) return { error: 'As opções --provider, --profile, --region, --subscription, --resource-group e --project só valem para "import cloud" e "check --cloud".' };
  if (args.command === 'check' && args.provider !== undefined) return { error: 'No check use --cloud aws|azure|gcp|<arquivo>, não --provider.' };
  if (args.file !== undefined && args.command !== 'import') return { error: 'A opção --file só vale para "import cloud".' };
  if (args.cloud !== undefined && args.command !== 'check') return { error: 'A opção --cloud só vale para o comando check.' };
  if (args.command === 'import') {
    if ((args.provider === undefined) === (args.file === undefined)) return { error: 'O "import cloud" precisa de exatamente um entre --provider aws|azure|gcp e --file <terraform-show.json>.' };
    if (args.provider !== undefined && !['aws', 'azure', 'gcp'].includes(args.provider)) return { error: `Provedor inválido: "${args.provider}". Use aws, azure ou gcp.` };
    if (args.file !== undefined && cloudFlags) return { error: 'Com --file não há consulta ao CLI da nuvem: as opções --profile, --region, --subscription, --resource-group e --project não se aplicam.' };
  }
  if ((args.cloudUrl || args.pair) && args.command !== 'connect') return { error: '--cloud-url and --pair require connect.' };
  if (args.pair && !args.cloudUrl) return { error: 'Use --cloud-url and --pair together.' };
  if (args.stage !== undefined) {
    if (args.command !== 'diff') return { error: 'A opção --stage só vale para o comando diff.' };
    if (args.refs.length) return { error: 'A opção --stage compara o diagrama atual com um estágio: não combine com refs do git.' };
    if (parseStage(args.stage) === null) return { error: `Estágio inválido: "${args.stage}". Use atual, transição ou planejado.` };
  }
  if (args.svg !== undefined && args.command !== 'diff') return { error: 'A opção --svg só vale para o comando diff.' };
  if (args.artifactUrl !== undefined && args.command !== 'pr-comment') return { error: 'A opção --artifact-url só vale para o comando pr-comment.' };
  if (args.strict && args.command !== 'verify' && !args.drift && args.cloud === undefined) return { error: '--strict requer --drift.' };
  if (args.command === 'publish' && !args.title) return { error: 'O publish precisa de --title.' };
  if (args.command === 'pr-comment' && !args.base) return { error: 'O pr-comment precisa de --base (o ref base do PR).' };
  return args;
}

function setValue(args: CliArgs, flag: ValueFlag, value: string): void {
  if (flag === '--cloud-url') args.cloudUrl = value;
  else if (flag === '--pair') args.pair = value;
  else if (flag === '--dir') { args.dir = value; args.dirExplicit = true; }
  else if (flag === '--out') args.out = value;
  else if (flag === '--format') args.format = value;
  else if (flag === '--title') args.title = value;
  else if (flag === '--body-file') args.bodyFile = value;
  else if (flag === '--branch') args.branch = value;
  else if (flag === '--base') args.base = value;
  else if (flag === '--pr') args.pr = value;
  else if (flag === '--head') args.head = value;
  else if (flag === '--svg') args.svg = value;
  else if (flag === '--stage') args.stage = value;
  else if (flag === '--artifact-url') args.artifactUrl = value;
  else if (flag === '--kind') args.kind = value;
  else if (flag === '--include') args.include.push(value);
  else if (flag === '--diagram') args.diagram = value;
  else if (flag === '--mode') args.mode = value;
  else if (flag === '--provider') args.provider = value;
  else if (flag === '--profile') args.profile = value;
  else if (flag === '--region') args.region = value;
  else if (flag === '--subscription') args.subscription = value;
  else if (flag === '--resource-group') args.resourceGroup = value;
  else if (flag === '--project') args.project = value;
  else if (flag === '--file') args.file = value;
  else if (flag === '--cloud') args.cloud = value;
}
