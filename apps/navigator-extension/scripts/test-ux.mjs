import assert from 'node:assert/strict';
import fs from 'node:fs';
import { horizontalLayout,defaultTrackPreferences } from '../domain/timeline-tracks.js';
import { fitNodeViewport,visibleNodeViewport } from '../domain/canvas-viewport.js';
const cards=Array.from({length:300},(_,i)=>({id:'c'+i,ordinal:i,validity:{state:'ACTIVE'},questionTime:{value:new Date(Date.UTC(2026,9,13,4)+i*300000).toISOString()}}));
const data={cards:cards.slice(0,22),timelines:[{id:'t0',kind:'source'}],memberships:cards.map(c=>({cardId:c.id,timelineId:'t0'}))},pref={...defaultTrackPreferences(data),scale:'month'};
let l=horizontalLayout(data,pref,1000);assert.equal(l.known.length,22);assert.equal(l.points.length,22);assert(l.tickStep<86400000);assert(l.position(l.first)>0&&l.position(l.last)<1000);
assert(Math.abs((l.position(Date.parse(cards[10].questionTime.value))-l.position(l.first))/(l.position(l.last)-l.position(l.first))-10/21)<1e-10);
const mixed={cards,timelines:Array.from({length:4},(_,i)=>({id:'t'+i,kind:'source'})),memberships:cards.flatMap((c,i)=>[{cardId:c.id,timelineId:'t'+i%4},{cardId:c.id,timelineId:'t'+(i+1)%4}])};
const p=defaultTrackPreferences(mixed);assert.equal(p.selectedTimelineIds.length,4);l=horizontalLayout(mixed,p,375);assert.equal(l.known.length,300);assert.deepEqual(l.points.flatMap(q=>q.cards).map(c=>c.id),cards.map(c=>c.id));assert(l.points.every(p=>p.x>=0&&p.x<=375));
const bad={...data,cards:[...data.cards,{id:'unknown',ordinal:23,validity:{state:'ACTIVE'},questionTime:{value:'bad'}}],memberships:[...data.memberships,{cardId:'unknown',timelineId:'t0'}]};assert.equal(horizontalLayout(bad,pref).unknown.length,1);
const two=[{x:0,y:0},{x:320,y:0}],v=fitNodeViewport(two,1200,650);assert(v.zoom>=1&&visibleNodeViewport(two,v,1200,650));assert(Math.abs(v.x+(590/2)*v.zoom-600)<1e-9);assert(Math.abs(v.y+115*v.zoom-325)<1e-9);
const fifty=Array.from({length:50},(_,i)=>({x:i%7*320,y:Math.floor(i/7)*270})),large=fitNodeViewport(fifty,1200,650);assert(visibleNodeViewport(fifty,large,1200,650));assert(!visibleNodeViewport(two,{x:-50000,y:-50000,zoom:1},1200,650));
for(const page of ['workspace.html','sidepanel.html']){const html=fs.readFileSync(page,'utf8');assert(!/来源树|tree-view-button|qa-view-button|来源工具/.test(html));const app=fs.readFileSync('ui/app.js','utf8');for(const id of [...app.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]))assert(html.includes(`id="${id}"`),'Missing UI control '+id);}
assert(!fs.existsSync('ui/conversation-map.js'));
const report={ok:true,cases:['22轮小时范围、真实时间比例、旧月尺度自动适配','4来源混合300轮、稳定去重、密度成员不丢失','无效时间独立区域','2/50节点中心与空白视口检测','来源树移除及两页面绑定完整'],scope:'focused domain and static UI invariants'};fs.writeFileSync('dist/UX_NODE_REPORT.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
