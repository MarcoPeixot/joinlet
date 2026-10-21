import { describe, expect, it } from 'vitest';
import { documentPdfDefinition } from './pdf';

describe('document PDF', () => {
  it('preserves Portuguese text, nested formatting, tables, lists and code as document data', () => {
    const pdf = documentPdfDefinition('Decisões', '# Decisões\n\nTexto **forte e *ênfase***.\n\n| Serviço | Função |\n| --- | --- |\n| API | Autenticação |\n\n1. Primeiro\n2. Segundo\n\n```js\nconst x = 1;\n```');
    const json = JSON.stringify(pdf.content);
    expect(json).toContain('Autenticação');
    expect(json).toContain('const x = 1;');
    expect(json).toContain('"headerRows":1');
    expect(json).toContain('"italics":true,"bold":true');
    expect(json).toContain('"ol":');
    expect(pdf.info?.title).toBe('Decisões');
    expect(pdf.pageSize).toBe('A4');
  });
  it('adds a title to plain/empty documents and never loads images or unsafe links', () => {
    const empty = documentPdfDefinition('Vazio', '');
    expect(JSON.stringify(empty.content)).toContain('Vazio');
    const content = JSON.stringify(documentPdfDefinition('Seguro', '[seguro](https://example.com) [ruim](javascript:alert)\n\n![alt](https://track.example/pixel.png)\n\n<script>alert(1)</script>').content);
    expect(content).toContain('"link":"https://example.com"');
    expect(content).not.toContain('javascript:');
    expect(content).not.toContain('track.example');
    expect(content).not.toContain('script');
    expect(content).not.toContain('alert');
  });
});

it('exports resolved reference labels in prose and tables while preserving code literals',()=>{
 const resolve=(ref:string)=>ref==='arch#API'?{diagram:'arch',id:'API',label:'API Gateway',diagramTitle:'Architecture'}:null;
 const pdf=documentPdfDefinition('References','Veja [[arch#API]].\n\n| Nó | Papel |\n| --- | --- |\n| [[arch#API]] | Entrada |\n\n`[[arch#API]]`',resolve);
 const text=JSON.stringify(pdf.content);expect(text).toContain('API Gateway');expect(text).toContain('[[arch#API]]');
});
