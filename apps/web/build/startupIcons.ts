import {icons} from 'lucide';
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../src/diagram/icons/',import.meta.url);
const brands=JSON.parse(readFileSync(new URL('simple-subset.json',root),'utf8'));
const names=['nginx','react','nodedotjs','postgresql','redis','apachekafka'];
writeFileSync(new URL('simple-core.json',root),JSON.stringify(Object.fromEntries(names.map(name=>[name,brands[name]])))+'\n');
const generic=['MonitorSmartphone','Server','Smartphone','Database','Layers','Globe','Plug','HardDrive','Box','Users','Shield','Cloud','FileText','Clock','Activity','Network','Circle','Square','CircleHelp'];
writeFileSync(new URL('lucide-core.json',root),JSON.stringify(Object.fromEntries(generic.map(name=>[name,icons[name as keyof typeof icons]])))+'\n');

writeFileSync(new URL('lucide-keys.json',root),JSON.stringify(Object.keys(icons).sort())+'\n');
