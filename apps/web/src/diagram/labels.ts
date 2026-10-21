import { uiText } from '../i18n';
import type { ColorMode, Connector, Direction, Shape, StyleMode, Typeface } from '@strukt/core';

export const SHAPE_LABELS: Record<Shape, string> = {
  rectangle: uiText("Retângulo"),
  cylinder: uiText("Cilindro"),
  diamond: uiText("Losango"),
  document: uiText("Documento"),
  ellipse: uiText("Elipse"),
  hexagon: uiText("Hexágono"),
  oval: 'Oval',
  parallelogram: uiText("Paralelogramo"),
  star: uiText("Estrela"),
  trapezoid: uiText("Trapézio"),
  triangle: uiText("Triângulo"),
  circle: uiText("Círculo"),
  cloud: uiText("Nuvem / sistema externo"),
  queue: uiText("Fila de mensagens"),
  bucket: uiText("Armazenamento de objetos"),
  actor: uiText("Pessoa / ator"),
  component: uiText("Componente / serviço"),
  server: uiText("Servidor"),
  browser: uiText("Navegador"),
  mobile: uiText("Celular"),
  package: uiText("Pacote / módulo"),
  note: uiText("Nota"),
  process: uiText("Subprocesso"),
  delay: uiText("Espera / atraso"),
};

export const CONNECTOR_LABELS: Record<Connector, { symbol: string; label: string }> = {
  '>': { symbol: '→', label: uiText("Seta") },
  '<': { symbol: "←", label: uiText("Seta inversa") },
  '<>': { symbol: '↔', label: uiText("Seta dupla") },
  '-': { symbol: '—', label: uiText("Linha") },
  '--': { symbol: '┄', label: uiText("Pontilhada") },
  '-->': { symbol: '┄→', label: uiText("Pontilhada com seta") },
};

export const COLOR_MODE_LABELS: Record<ColorMode, string> = { pastel: uiText("Suave"), bold: uiText("Forte"), outline: uiText("Contorno") };
export const STYLE_MODE_LABELS: Record<StyleMode, string> = { shadow: uiText("Sombra"), plain: uiText("Liso"), watercolor: uiText("Aquarela") };
export const TYPEFACE_LABELS: Record<Typeface, string> = { rough: uiText("À mão"), clean: uiText("Limpa"), mono: 'Mono' };
export const DIRECTION_LABELS: Record<Direction, string> = { right: '→', down: '↓', left: "←", up: '↑' };
