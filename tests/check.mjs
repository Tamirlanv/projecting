import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['tickets.js','theory.js','practice.js','quiz.js','app.js'];
const sources=Object.fromEntries(files.map(f=>[f,readFileSync(path.join(root,'assets',f),'utf8')]));
const plain=value=>JSON.parse(JSON.stringify(value));
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Имитация только используемой поверхности DOM. Проверяет логику, не CSS/раскладку.
function boot({storage=new Map(),hash='',denyStorage=false,now=1800000000000}={}){
 const documentEvents={},windowEvents={},elements=new Map(),clock={now},downloads=[],blobs=new Map();
 const stable=new Set(['#main','#navigation','#side-progress','#breadcrumb-current','#toast','#source-dialog']);
 class Element{
  constructor(id=''){this.id=id;this.dataset={};this.disabled=false;this.open=false;this.value='';this.tagName='DIV';this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};this._html='';this.textContent='';this.listeners={};}
  set innerHTML(html){this._html=html;if(this.id==='#main')for(const id of elements.keys())if(!stable.has(id))elements.delete(id);}
  get innerHTML(){return this._html;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  closest(selector){if(selector==='[data-action]')return this.dataset.action?this:null;return null;}
  matches(selector){return selector==='[data-search]'?Boolean(this.search):false;}
  focus(){}scrollIntoView(){}remove(){}append(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.close?.();}
  click(){downloads.push({href:this.href,name:this.download});}
 }
 for(const name of stable)elements.set(name,new Element(name));
 const document={
  title:'',body:new Element(),
  querySelector(selector){
   if(elements.has(selector))return elements.get(selector);
   const html=elements.get('#main').innerHTML+elements.get('#source-dialog').innerHTML;
   if(selector==='#study-content .answer'&&html.includes('class="answer"')){const e=new Element(selector);elements.set(selector,e);return e;}
   if(selector.startsWith('#')&&html.includes(`id="${selector.slice(1)}"`)){const e=new Element(selector);e._html=html.slice(html.indexOf(`id="${selector.slice(1)}"`));elements.set(selector,e);return e;}
   return null;
  },
  createElement:()=>new Element(),
  addEventListener:(name,fn)=>documentEvents[name]=fn
 };
 class FakeDate extends Date{static now(){return clock.now;}}
 const location={hash};
 const context=vm.createContext({
  window:{addEventListener:(name,fn)=>windowEvents[name]=fn,scrollTo(){}},
  document,location,history:{replaceState(a,b,hash){location.hash=hash;}},
  localStorage:{getItem(k){if(denyStorage)throw Error('blocked');return storage.get(k)||null;},setItem(k,v){if(denyStorage)throw Error('blocked');storage.set(k,v);}},
  navigator:{clipboard:{async writeText(text){context.copied=text;}}},
  Date:FakeDate,Blob,URL:{createObjectURL(blob){const url=`blob:${blobs.size}`;blobs.set(url,blob);return url;},revokeObjectURL(){}},
  setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{context.tick=fn;return 1;},console
 });
 for(const file of files)vm.runInContext(sources[file],context,{filename:file});
 return{
  context,storage,clock,downloads,blobs,
  html:()=>elements.get('#main').innerHTML,
  fragment:selector=>document.querySelector(selector)?.innerHTML||'',
  el:selector=>document.querySelector(selector),
  saved:()=>JSON.parse(storage.get('projecting.study.v1')||'null'),
  route(hash){location.hash=hash;windowEvents.hashchange();},
  async click(action,data={}){const target=new Element();target.dataset={action,...data};await documentEvents.click({target,preventDefault(){}});},
  async input(props){const target=Object.assign(new Element(),props);await documentEvents.input({target});return target;},
  async change(props){const target=Object.assign(new Element(),props);await documentEvents.change({target});return target;},
  async key(props){let prevented=false;const target=new Element();await documentEvents.keydown({key:'',code:'',target,preventDefault(){prevented=true;},...props});return prevented;}
 };
}

test('Все 30 билетов имеют 60 конспектов, 30 разборов и 60 уникальных тестовых вопросов',()=>{
 const app=boot(),w=app.context.window;
 assert.equal(w.EXAM_TICKETS.length,30);assert.equal(w.EXAM_THEORY.length,30);assert.equal(w.EXAM_PRACTICE.length,30);assert.equal(w.EXAM_QUIZ.length,60);
 assert.equal(new Set(w.EXAM_QUIZ.map(q=>q.id)).size,60);
 for(let i=0;i<30;i++){
  assert.equal(w.EXAM_TICKETS[i].id,i+1);assert.equal(w.EXAM_TICKETS[i].questions.length,3);
  assert.equal(w.EXAM_THEORY[i].length,2);
  for(const a of w.EXAM_THEORY[i]){assert.ok(a.title&&a.lead.length>60&&a.points.length>=3&&a.example&&a.trap);for(const source of a.sources)assert.ok(w.EXAM_SOURCES.find(s=>s.id===source));}
  const p=w.EXAM_PRACTICE[i];assert.equal(p.steps.length,3);assert.equal(p.checks.length,3);assert.ok(p.code.startsWith('@startuml\n'));assert.ok(p.code.endsWith('@enduml'));
  for(let section=0;section<2;section++){const q=w.EXAM_QUIZ.find(q=>q.ticket===i+1&&q.section===section);assert.ok(q);assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);assert.ok(q.why.length>30);}
 }
});

test('Все 90 карточек открываются, содержат исходный вопрос и полный ответ',async()=>{
 const app=boot();
 for(const t of app.context.window.EXAM_TICKETS)for(let s=0;s<3;s++){
  app.route(`#ticket/${t.id}/${s}`);assert.ok(app.html().includes(escape(t.questions[s])));
  assert.ok(!app.html().includes('class="answer"'));
  await app.click('reveal');
  assert.ok(app.html().includes('class="answer"'));
  const content=s===2?app.context.window.EXAM_PRACTICE[t.id-1]:app.context.window.EXAM_THEORY[t.id-1][s];
  assert.ok(app.html().includes(escape(content.title)));
 }
});

test('Поиск, тематические фильтры и избранное работают независимо',async()=>{
 const app=boot();app.route('#tickets');assert.equal((app.html().match(/class="ticket-card"/g)||[]).length,30);
 await app.input({search:true,value:'несуществующая-тема-123'});assert.ok(app.fragment('#ticket-results').includes('Здесь пока нет билетов'));
 await app.input({search:true,value:'ПИН'});assert.ok(app.fragment('#ticket-results').includes('Билет 02'));
 await app.click('clear-filters');
 await app.change({id:'topic-filter',value:'idef3'});assert.equal((app.fragment('#ticket-results').match(/class="ticket-card"/g)||[]).length,3);
 await app.click('clear-filters');await app.click('bookmark',{id:'7'});await app.click('filter',{filter:'bookmarks'});
 assert.equal((app.html().match(/class="ticket-card"/g)||[]).length,1);assert.ok(app.html().includes('Билет 07'));
 assert.deepEqual(app.saved().bookmarks,[7]);
});

test('Отметки сохраняются, повторение наступает вовремя, изучен только полный билет',async()=>{
 const app=boot();
 for(let s=0;s<3;s++){app.route(`#ticket/1/${s}`);await app.click('reveal');await app.click('rate',{rating:'known'});}
 assert.equal(Object.values(app.saved().progress).filter(p=>p.status==='known').length,3);
 app.route('#tickets');await app.click('filter',{filter:'known'});assert.ok(app.html().includes('Билет 01'));assert.equal((app.html().match(/class="ticket-card"/g)||[]).length,1);
 await app.click('filter',{filter:'due'});assert.ok(app.html().includes('Здесь пока нет билетов'));
 app.clock.now+=3*86400000+1;app.route('#tickets');assert.ok(app.html().includes('Билет 01'));
 const resumed=boot({storage:app.storage,hash:'#ticket/1/0',now:app.clock.now});await resumed.click('reveal');assert.ok(resumed.html().includes('known selected'));
 await resumed.input({dataset:{note:'1-0'},value:'Мой пример <script>alert(1)</script>'});
 resumed.route('#ticket/1/0');assert.ok(resumed.html().includes('&lt;script&gt;'));assert.ok(!resumed.html().includes('<script>alert'));
});

test('Навигация на границах не создаёт несуществующих билетов',async()=>{
 const app=boot({hash:'#ticket/1/0'});await app.click('prev');assert.ok(app.html().includes('Билет 01'));
 await app.click('next');app.route(app.context.location.hash);assert.ok(app.html().includes('Теоретический вопрос 2'));
 app.route('#ticket/30/2');await app.click('next');assert.equal(app.context.location.hash,'#overview');
 app.route('#ticket/999/0');assert.ok(app.html().includes('Хорошая точка старта'));
});

test('Все 60 тестовых вопросов оцениваются после перемешивания вариантов',async()=>{
 const app=boot({hash:'#quiz'});await app.change({name:'quiz-count',value:'60'});await app.click('start-quiz');
 const seen=new Set();
 for(let i=0;i<60;i++){
  const html=app.html();const prompt=html.match(/<h2 class="question-text">(.*?)<\/h2>/s)?.[1];
  const q=app.context.window.EXAM_QUIZ.find(q=>escape(q.prompt)===prompt);assert.ok(q);seen.add(q.id);
  const options=[...html.matchAll(/data-action="choose" data-choice="(\d+)"[^>]*><span class="option-index">.*?<\/span><span>(.*?)<\/span>/gs)];
  assert.equal(options.length,4);
  const correct=options.find(m=>m[2]===escape(q.options[q.correct]));assert.ok(correct);
  await app.click('choose',{choice:correct[1]});await app.click('check-answer');assert.ok(app.html().includes('Верно. Отличная работа!'));await app.click('quiz-next');
 }
 assert.equal(seen.size,60);assert.ok(app.html().includes('Всё верно. Так держать!'));
 assert.equal(app.saved().history[0].correct,60);assert.equal(app.saved().history[0].total,60);
 assert.equal(Object.keys(app.saved().progress).length,0,'Тест не выдаёт отметку «Знаю» автоматически');
});

test('Ошибка теста попадает в повторение, а досрочный результат учитывает отвеченные вопросы',async()=>{
 const app=boot({hash:'#quiz'});await app.click('start-quiz');
 const q=app.context.window.EXAM_QUIZ.find(q=>app.html().includes(escape(q.prompt)));
 const options=[...app.html().matchAll(/data-action="choose" data-choice="(\d+)"[^>]*><span class="option-index">.*?<\/span><span>(.*?)<\/span>/gs)];
 const wrong=options.find(m=>m[2]!==escape(q.options[q.correct]));
 await app.click('choose',{choice:wrong[1]});await app.click('check-answer');await app.click('check-answer');
 assert.equal(app.saved().progress[`${q.ticket}-${q.section}`].status,'again');
 await app.click('quit-quiz');assert.equal(app.saved().history[0].total,1);assert.equal(app.saved().history[0].correct,0);
 assert.ok(app.html().includes('Тест завершён досрочно'));assert.ok(app.html().includes('Что стоит повторить'));
});

test('Тест по узкой теме содержит только доступные вопросы',async()=>{
 const app=boot({hash:'#quiz'});await app.change({id:'quiz-topic',value:'idef3'});assert.ok(app.html().includes('В выбранной теме: 3. В тест войдёт 3.'));
 await app.click('start-quiz');assert.ok(app.html().includes('Вопрос 1 из 3'));
 const q=app.context.window.EXAM_QUIZ.find(q=>app.html().includes(escape(q.prompt)));assert.ok([19,20,21].includes(q.ticket));assert.equal(q.section,1);
});

test('Экзамен сохраняет черновик и таймер, рубрика ограничена 100 баллами',async()=>{
 const app=boot({hash:'#exam'});await app.click('start-exam');app.clock.now+=25000;app.context.tick();assert.equal(app.el('#exam-clock').textContent,'00:25');
 await app.input({dataset:{examNote:'0'},value:'Мой план ответа'});await app.click('pause-exam');assert.equal(app.saved().exam.elapsed,25000);
 app.clock.now+=5000;assert.equal(app.saved().exam.elapsed,25000);
 const resumed=boot({storage:app.storage,hash:'#exam',now:app.clock.now});assert.ok(resumed.html().includes('Мой план ответа'));assert.ok(resumed.html().includes('Таймер на паузе'));
 await resumed.click('pause-exam');resumed.clock.now+=5000;await resumed.click('finish-exam');assert.equal(resumed.saved().exam.elapsed,30000);
 for(let s=0;s<3;s++)for(let i=0;i<4;i++)await resumed.input({dataset:{grade:`${s}-${i}`},value:'999'});
 assert.equal(resumed.saved().exam.grades.flat().reduce((a,b)=>a+b,0),100);assert.ok(resumed.el('#exam-score').textContent.includes('100 / 100 · A'));
 await resumed.input({dataset:{grade:'0-0'},value:'-10'});assert.equal(resumed.saved().exam.grades[0][0],0);
});

test('Экспорт/импорт переносят данные и отклоняют посторонний JSON',async()=>{
 const app=boot();await app.click('bookmark',{id:'4'});await app.click('sources');await app.click('export');
 assert.equal(app.downloads[0].name,'projecting-progress.json');
 const blob=app.blobs.get(app.downloads[0].href),json=await blob.text();assert.deepEqual(JSON.parse(json).bookmarks,[4]);
 const target=boot();await target.click('sources');await target.change({id:'import-file',files:[{size:json.length,text:async()=>json}]});assert.deepEqual(target.saved().bookmarks,[4]);
 await target.change({id:'import-file',files:[{size:2,text:async()=>'{}'}]});assert.ok(target.el('#toast').textContent.includes('Не удалось прочитать'));
});

test('Открытие прямой ссылки на источники и запрет localStorage не ломают сайт',async()=>{
 const app=boot({hash:'#sources'});assert.ok(app.html().includes('Хорошая точка старта'));assert.equal(app.el('#source-dialog').open,true);
 const blocked=boot({denyStorage:true,hash:'#ticket/1/0'});await blocked.click('reveal');await blocked.click('rate',{rating:'known'});assert.ok(blocked.html().includes('known selected'));
});

test('Статический сайт содержит локальные ресурсы и не требует сетевых запросов',()=>{
 const html=readFileSync(path.join(root,'index.html'),'utf8');
 for(const match of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g))assert.ok(existsSync(path.join(root,match[1])),match[1]);
 for(const file of files)assert.ok(!/\bfetch\(|XMLHttpRequest|https?:\/\/.*\.(?:js|css)/.test(sources[file]),file);
 const css=readFileSync(path.join(root,'assets/styles.css'),'utf8');assert.equal(css.match(/{/g).length,css.match(/}/g).length);
 assert.ok(css.includes('@media(max-width:480px)'));assert.ok(css.includes('prefers-reduced-motion'));
});

test('Все 30 схем существуют, исходники совпадают с разбором и SVG не содержат ошибок или внешних ресурсов',()=>{
 const app=boot();
 for(let i=1;i<=30;i++){
  const svg=readFileSync(path.join(root,`assets/diagrams/ticket-${i}.svg`),'utf8');
  const puml=readFileSync(path.join(root,`assets/diagrams/ticket-${i}.puml`),'utf8');
  assert.equal(puml,app.context.window.EXAM_PRACTICE[i-1].code+'\n');
  assert.ok(svg.includes('<svg'));assert.ok(svg.includes('viewBox='));
  assert.ok(!/Syntax Error|The syntax using|<script|<foreignObject|(?:href|src)="https?:/i.test(svg),`ticket-${i}`);
 }
});
