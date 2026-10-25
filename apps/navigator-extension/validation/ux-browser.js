import { isolateValidationDatabase } from './isolated-db.js';
import { command,mutate } from '../storage/repository.js';
import { createProject,saveConversation } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { graph,user,body } from './qa-p0-fixtures.mjs';
const ns=new URLSearchParams(location.search).get('validationDb');if(!/^v04-ux-[a-z0-9-]+$/.test(ns??''))throw Error('Isolated namespace required');isolateValidationDatabase(ns);
const output=document.querySelector('#report'),seed=document.querySelector('#seed');seed.disabled=false;output.textContent='就绪';
function fixture(source,count,start){let parent='root',rows=[];for(let n=0;n<count;n++){rows.push(['q'+n,parent,user('q'+n,`第 ${n+1} 问 · 中文研究与上下文整理`,start+n*300)]);rows.push(['a'+n,'q'+n,body('a'+n,'# 完整有效回答\n\n这是明确合成的 UI 验证内容。\n\n'+('阅读面板独立滚动，来源与用户判断分别保存。\n\n'.repeat(n===0?100:5))+'~~~python\nprint("保留代码")\n~~~\n\nEND-'+source+'-'+n)]);parent='a'+n;}const raw=graph(rows,parent,'ux-'+source);raw.title='来源 '+source+' · 中文工程';return raw;}
seed.addEventListener('click',async()=>{seed.disabled=true;try{const start=performance.now(),projects={};for(const [label,counts] of [['22轮单日',[22]],['四来源混合50轮',[22,8,10,10]],['两节点画布',[2]],['300轮长对话',[100,100,100]]]){const p=await mutate(state=>createProject(state,label));projects[label]=p.id;for(let i=0;i<counts.length;i++){const payload=fixture(label+'-'+i,counts[i],Date.parse('2026-10-13T04:00:00Z')/1000+i*1800);const c=(await parseImport(JSON.stringify(payload),'ux-synthetic.json')).conversations[0];await mutate(state=>saveConversation(state,c,p.id));}}
 const cards=(await command('opcTimeline',{projectId:projects['四来源混合50轮']})).cards;await command('opcWrite',{projectId:projects['四来源混合50轮'],action:'relationship',fromCardId:cards[0].id,toCardId:cards[25].id,type:'依赖',directed:true,confirmationStatus:'USER_CONFIRMED'});
 const report={ok:true,projects,seedMs:Math.round(performance.now()-start),total:374};output.textContent=JSON.stringify(report,null,2);
 for(const [label,id]of Object.entries(projects)){const a=document.createElement('a');a.href='/workspace.html?validationDb='+ns+'&projectId='+id;a.textContent=label;document.querySelector('#links').append(a);}localStorage.setItem(ns+':seed',JSON.stringify(report));
}catch(e){output.textContent=e.stack;}});
