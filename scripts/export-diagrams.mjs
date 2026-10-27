import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ctx=vm.createContext({window:{}});
vm.runInContext(readFileSync(path.join(root,'assets/practice.js'),'utf8'),ctx);
const dir=path.join(root,'assets/diagrams');
mkdirSync(dir,{recursive:true});
ctx.window.EXAM_PRACTICE.forEach((p,i)=>writeFileSync(path.join(dir,`ticket-${i+1}.puml`),p.code+'\n'));
console.log('Экспортировано 30 исходников диаграмм.');
