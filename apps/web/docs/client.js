(() => {
  const lang = document.body.dataset.lang;
  const pt = lang === 'pt-BR';
  const t = (en,br) => pt ? br : en;
  const theme = document.querySelector('.theme');
  try { const saved=localStorage.getItem('strukt:theme'); if(['dark','light','contrast'].includes(saved)) document.documentElement.dataset.theme=saved==='contrast'?'dark':saved; } catch {}
  theme.hidden=false;
  theme.addEventListener('click',()=>{
    const dark=document.documentElement.dataset.theme ? document.documentElement.dataset.theme==='dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    const next=dark?'light':'dark';document.documentElement.dataset.theme=next;
    try {localStorage.setItem('strukt:theme',next);} catch {}
  });
  document.querySelector('.language').addEventListener('click',event=>{try{localStorage.setItem('joinlet:locale',event.currentTarget.lang);}catch{}});
  const menu=document.querySelector('.docs-menu');
  const media=matchMedia('(max-width:900px)');
  const resize=()=>{menu.open=!media.matches;};resize();media.addEventListener('change',resize);
  for (const pre of document.querySelectorAll('pre')) {
    const button=document.createElement('button');button.type='button';button.className='copy';button.textContent=t('Copy','Copiar');
    button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pre.querySelector('code').textContent);button.textContent=t('Copied','Copiado');}catch{button.textContent=t('Select and copy','Selecione e copie');}setTimeout(()=>button.textContent=t('Copy','Copiar'),1800);});
    pre.append(button);
  }
  const search=document.querySelector('.search');search.hidden=false;
  const input=document.querySelector('#docs-search'), results=document.querySelector('#search-results'), status=results.querySelector('p'), list=results.querySelector('ul');
  let index, pending;
  const fold=text=>text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const load=()=>index ? Promise.resolve(index) : pending??=(fetch(`/docs/${lang}/search.json`).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>index=data).catch(error=>{pending=undefined;throw error;}));
  input.addEventListener('focus',()=>{load().catch(()=>{});if(input.value.trim())show();});
  async function show() {
    const query=input.value.trim();list.replaceChildren();
    if(!query){results.hidden=true;return;}
    results.hidden=false;status.textContent=t('Searching…','Buscando…');
    try {
      const docs=await load();if(input.value.trim()!==query)return;
      list.replaceChildren();
      const words=fold(query).split(/\s+/);
      const matches=docs.map(doc=>({...doc,score:words.reduce((sum,word)=>sum+(fold(doc.title).includes(word)?4:0)+(fold(doc.summary).includes(word)?2:0),0)})).filter(doc=>words.every(word=>fold(doc.title+' '+doc.text).includes(word))).sort((a,b)=>b.score-a.score).slice(0,10);
      status.textContent=matches.length?t(`${matches.length} results`,`${matches.length} resultados`):t('No results. Try another term.','Nenhum resultado. Tente outro termo.');
      for(const doc of matches){const li=document.createElement('li'),link=document.createElement('a'),title=document.createElement('strong'),snippet=document.createElement('span');link.href=doc.url;title.textContent=doc.title;snippet.textContent=doc.summary;link.append(title,snippet);li.append(link);list.append(li);}
    } catch {if(input.value.trim()===query)status.textContent=t('Search is unavailable. Use the documentation menu.','Busca indisponível. Use o menu da documentação.');}
  }
  input.addEventListener('input',show);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){results.hidden=true;input.blur();}
    if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();input.focus();}
  });
  document.addEventListener('click',event=>{if(!search.contains(event.target))results.hidden=true;});
})();
