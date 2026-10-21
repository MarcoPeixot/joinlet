import { streamingFixture } from '../../../packages/layout/src/nestedComposition.fixture';
import {expect,test} from '@playwright/test';
import {computeRects,unionRect} from '@strukt/core';
import type {DiagramModel} from '@strukt/core';
import {printDiagramJson} from '@strukt/json';
import {eraserRouter,roundedPath,trimEnd} from '@strukt/layout';
import fixture from '../../../packages/layout/src/groupComposition.fixture.json' with {type:'json'};
import mixed from '../../../packages/layout/src/flowComposition.fixture.json' with {type:'json'};
import {savedDiagram} from './storage';

test('the nested user example reads frontend then edge then services then data',async({page})=>{
  await page.goto('/app/');
  await page.getByRole('button',{name:'Mostrar/ocultar código',exact:true}).click();
  await page.locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(printDiagramJson(mixed as DiagramModel));
  await expect(page.locator('.react-flow__node-card')).toHaveCount(15);
  await page.getByRole('button',{name:'Mostrar/ocultar código',exact:true}).click();
  await page.getByRole('button',{name:'Aparência do diagrama',exact:true}).click();
  await page.getByRole('button',{name:'Compor arquitetura',exact:true}).click();await page.keyboard.press('Escape');
  await expect.poll(async()=> (await savedDiagram(page))?.model.elements.Frontend?.layoutRole).toBe('entry');
  const state=(await savedDiagram(page))!,rects=computeRects(state.model,state.layout);
  expect(state.model.edges).toHaveLength(21);
  expect(rects.Frontend!.x+rects.Frontend!.w).toBeLessThan(rects.Borda!.x);
  expect(rects.Borda!.x+rects.Borda!.w).toBeLessThan(rects['Serviços']!.x);
  expect(rects['Serviços']!.x+rects['Serviços']!.w).toBeLessThan(rects.Dados!.x);
  expect(rects.Kafka!.y).toBeGreaterThan(rects['Serviços']!.y+rects['Serviços']!.h);
  await expect(page.locator('.strukt-icon-missing')).toHaveCount(0);
  const path=page.locator('.react-flow__edge[data-id="API Gateway→Catálogo"] .react-flow__edge-path');
  await expect.poll(async()=>{
    const d=await path.getAttribute('d');
    const points=[...(d??'').matchAll(/[MLQ]([^MLQ]+)/g)].map(match=>match[1]!.trim().split(/[ ,]+/).map(Number).slice(-2));
    if(points.length<3)return false;
    const others=Object.values(state.model.elements).filter(el=>el.kind==='node'&&!['API Gateway','Catálogo'].includes(el.id)).map(el=>rects[el.id]!);
    return points.slice(1).every((point,i)=>!others.some(r=>Math.min(points[i]![0]!,point[0]!)<r.x+r.w-1&&Math.max(points[i]![0]!,point[0]!)>r.x+1&&Math.min(points[i]![1]!,point[1]!)<r.y+r.h-1&&Math.max(points[i]![1]!,point[1]!)>r.y+1));
  },{timeout:15000}).toBe(true);
  await page.mouse.move(1650,900);
  await page.screenshot({path:'/private/tmp/strukt-user-example-canvas.png'});
  await page.reload();
  await expect(page.locator('.react-flow__node-card')).toHaveCount(15);
  await expect.poll(async()=> (await savedDiagram(page))?.model.elements.Frontend?.layoutRole).toBe('entry');
});

test('group composition keeps the complete course diagram compact, editable and persistent',async({page})=>{
  await page.goto('/app/');
  await page.getByRole('button',{name:'Mostrar/ocultar código',exact:true}).click();
  await page.locator('.cm-content').click();await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(printDiagramJson(fixture as DiagramModel));
  await expect(page.locator('.react-flow__node-card')).toHaveCount(31);
  await expect(page.locator('.strukt-group')).toHaveCount(7);
  await page.getByRole('button',{name:'Mostrar/ocultar código',exact:true}).click();
  await page.getByRole('button',{name:'Aparência do diagrama',exact:true}).click();
  await page.getByRole('button',{name:'Compor arquitetura',exact:true}).click();await page.keyboard.press('Escape');
  await expect.poll(async()=> (await savedDiagram(page))?.model.elements['Experiências']?.layoutRole).toBe('entry');
  const saved=(await savedDiagram(page))!;
  const bounds=unionRect(Object.values(computeRects(saved.model,saved.layout)))!;
  expect(bounds.w).toBeLessThan(2600);expect(bounds.h).toBeLessThan(1300);
  expect(saved.model.edges).toHaveLength(45);
  const clipped=await page.locator('.strukt-scene-card__copy').evaluateAll(copies=>copies.flatMap(copy=>{
    const card=copy.closest('.strukt-scene-card'),a=card?.getBoundingClientRect(),b=copy.getBoundingClientRect();
    return !a||b.right>a.right+1||b.bottom>a.bottom+1?[copy.textContent]:[];
  }));
  expect(clipped).toEqual([]);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async()=> (await savedDiagram(page))?.model.elements['Experiências']?.layoutRole).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async()=> (await savedDiagram(page))?.model.elements['Experiências']?.layoutRole).toBe('entry');
  await page.reload();
  await expect(page.locator('.react-flow__node-card')).toHaveCount(31);
  await expect(page.locator('.react-flow__edge')).toHaveCount(45);
  const reopened=(await savedDiagram(page))!;
  expect(reopened.layout.nodes).toEqual(saved.layout.nodes);
  const expected=eraserRouter.route(reopened.model,computeRects(reopened.model,reopened.layout))['Experiências→Usuários e segurança']!;
  await expect(page.locator('.react-flow__edge[data-id="Experiências→Usuários e segurança"] .react-flow__edge-path')).toHaveAttribute('d',roundedPath(trimEnd(expected,9)),{timeout:15000});
  await page.mouse.move(1650,900);
  await page.screenshot({path:'/private/tmp/strukt-group-canvas.png'});
});


test('cloud hierarchy stays compact with icons, real routes and reload', async ({ page }, info) => {
  const model = streamingFixture();
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(printDiagramJson(model));
  await expect(page.locator('.react-flow__node-icon')).toHaveCount(10);
  await page.getByRole('button', { name: 'Mostrar/ocultar código', exact: true }).click();
  await page.getByRole('button', { name: 'Aparência do diagrama', exact: true }).click();
  await page.getByRole('button', { name: 'Compor arquitetura', exact: true }).click(); await page.keyboard.press('Escape');
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Cloud?.layoutRole).toBe('peer');
  await page.getByRole('button', { name: 'Aparência do diagrama', exact: true }).click();
  await expect(page.getByText('Orientação da composição', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Ajustar à tela', exact: true }).click();
  const state = (await savedDiagram(page))!, rects = computeRects(state.model, state.layout);
  expect(state.model.edges).toEqual(model.edges);
  expect(state.model.elements.Subnet!.parentId).toBe('VPC');
  expect(rects.Gateway!.x).toBeLessThan(rects.Playback!.x);
  expect(unionRect(Object.values(rects))!.w).toBeLessThan(2400);
  await expect(page.locator('.strukt-icon-missing')).toHaveCount(0);
  await expect(page.locator('.strukt-icon-node > svg')).toHaveCount(10);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(model.edges.length);
  await page.mouse.move(1650, 900);
  await page.screenshot({ path: info.outputPath('cloud-layers.png') });
  await page.evaluate(() => localStorage.setItem('strukt:theme', 'dark'));
  await page.reload();
  await expect(page.locator('.react-flow__node-icon')).toHaveCount(10);
  await expect.poll(async () => (await savedDiagram(page))?.model.elements.Subnet?.parentId).toBe('VPC');
  await expect(page.locator('.strukt-icon-node > svg')).toHaveCount(10);
  await expect.poll(() => page.evaluate(({ model, rects }) => model.edges.every(edge => {
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${CSS.escape(edge.id)}"] .react-flow__edge-path`);
    if (!path) return false;
    const length = path.getTotalLength();
    for (let at = 0; at <= length; at += 4) {
      const p = path.getPointAtLength(at);
      for (const id of model.order) if (model.elements[id]!.kind === 'node' && id !== edge.from && id !== edge.to) {
        const r = rects[id]!;
        if (p.x > r.x + 1 && p.x < r.x + r.w - 1 && p.y > r.y + 1 && p.y < r.y + r.h - 1) return false;
      }
    }
    return true;
  }), { model: state.model, rects }), { timeout: 15000 }).toBe(true);
  await page.screenshot({ path: info.outputPath('cloud-layers-dark.png') });
});
