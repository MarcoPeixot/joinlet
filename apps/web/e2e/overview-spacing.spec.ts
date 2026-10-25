import {expect, test} from '@playwright/test';

test('spaces existing Overview cards and routes without losing content or relationships', async ({page}, info) => {
  await page.goto('/app/?lang=pt-BR');
  await expect(page.locator('.react-flow')).toBeVisible();
  await page.evaluate(async () => {
    const {workspace} = await import('/src/workspace/appWorkspace.ts');
    await workspace.show({kind:'board'});
    workspace.updateBoard(() => ({version:1, cards:[
      {id:'spacing-a',kind:'note',text:'API',color:'#fdf3b5',x:40,y:40,w:280,h:200},
      {id:'spacing-b',kind:'note',text:'Storage',color:'#cfe4ff',x:360,y:40,w:280,h:200},
      {id:'spacing-c',kind:'note',text:'Worker',color:'#d9f2c5',x:40,y:280,w:280,h:200},
      {id:'spacing-d',kind:'note',text:'Docs',color:'#ffd9e0',x:360,y:280,w:280,h:200},
    ], sections:[{id:'spacing-section',title:'Existing group',x:20,y:20,w:640,h:480}],connections:[
      {id:'spacing-ab',from:'spacing-a',to:'spacing-b',label:'Reads'},
      {id:'spacing-cd',from:'spacing-c',to:'spacing-d',label:'Documents',bend:.3},
    ]}));
  });
  const snapshot = () => page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().data!.board);
  const before = await snapshot();
  await page.getByRole('button',{name:'Espaçar Overview',exact:true}).click();
  await expect.poll(async () => (await snapshot()).cards.find(c=>c.id==='spacing-b')!.x).toBe(440);
  const after = await snapshot();
  expect(after.cards.map(({x,y,...card})=>card)).toEqual(before.cards.map(({x,y,...card})=>card));
  expect(after.connections).toEqual(before.connections);
  expect(after.sections[0]).toMatchObject({w:720,h:560});
  await expect.poll(() => page.evaluate(async () => (await import('/src/board/boardRoutes.ts')).boardRoutesStore.getState().routes['spacing-ab']?.points[0]?.[0])).toBe(332);
  await expect.poll(() => page.evaluate(async () => (await import('/src/workspace/appWorkspace.ts')).workspace.store.getState().save)).toBe('saved');
  await page.screenshot({path:info.outputPath('overview-spacing.png'),animations:'disabled'});
  await page.reload();
  await expect(page.locator('.strukt-board')).toBeVisible();
  await expect.poll(async () => (await snapshot()).cards.find(c=>c.id==='spacing-b')?.x).toBe(440);
  expect((await snapshot()).connections).toEqual(before.connections);
});
