import { uiText } from '../i18n';
import { nodeVariant } from '@strukt/core';
import type { DiagramElement, Shape } from '@strukt/core';
import { pluralize } from '../ui/plural';

const SHAPE_WORDS: Record<Shape, string> = {
  rectangle: uiText("Caixa"),
  cylinder: uiText("Banco de dados"),
  diamond: uiText("Decisão"),
  document: uiText("Documento"),
  ellipse: uiText("Elipse"),
  hexagon: uiText("Hexágono"),
  oval: 'Oval',
  parallelogram: uiText("Paralelogramo"),
  star: uiText("Estrela"),
  trapezoid: uiText("Trapézio"),
  triangle: uiText("Triângulo"),
  circle: uiText("Círculo"),
  cloud: uiText("Nuvem"),
  queue: uiText("Fila de mensagens"),
  bucket: uiText("Armazenamento de objetos"),
  actor: uiText("Pessoa"),
  component: uiText("Componente"),
  server: uiText("Servidor"),
  browser: uiText("Navegador"),
  mobile: uiText("Celular"),
  package: uiText("Pacote"),
  note: uiText("Nota"),
  process: uiText("Subprocesso"),
  delay: uiText("Espera"),
};

/** Accessible name of a diagram node: kind, label, technology and how many connections it has. */
export function nodeAriaLabel(el: DiagramElement, degree: number, childCount = 0): string {
  const name = el.label ?? el.id;
  const parts: string[] = [];
  if (el.kind === 'group') {
    parts.push(`${el.canvasFrame ? uiText("Diagrama") : uiText("Grupo")} ${name}`);
    parts.push(childCount > 0 ? pluralize(childCount, uiText("elemento"), uiText("elementos")) : uiText("vazio"));
  } else {
    const variant = nodeVariant(el);
    const word = variant === 'table' ? uiText("Tabela") : variant === 'participant' ? uiText("Participante") : variant === 'icon' ? uiText("Ícone") : (SHAPE_WORDS[el.shape ?? 'rectangle'] ?? uiText("Caixa"));
    parts.push(`${word} ${name}`);
    if (el.tech) parts.push(uiText("tecnologia {0}", [el.tech]));
  }
  if (degree > 0) parts.push(pluralize(degree, uiText("conexão"), uiText("conexões"), 'f'));
  else if (el.kind === 'node') parts.push(uiText("sem conexões"));
  return parts.join(', ');
}

/** Accessible name of a connection ("Conexão de A para B, rótulo"): React Flow's own default is English. */
export function edgeAriaLabel(from: string, to: string, label?: string): string {
  const text = label?.trim();
  return uiText("Conexão de {0} para {1}{2}", [from, to, text ? `, ${text}` : '']);
}
