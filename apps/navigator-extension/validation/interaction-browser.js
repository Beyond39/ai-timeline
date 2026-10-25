import { isolateValidationDatabase } from './isolated-db.js';
import { command, mutate } from '../storage/repository.js';
import { readState } from '../storage/database.js';
import { parseImport } from '../importers/json.js';
import { saveConversation, createProject } from '../domain/captures.js';
import { graph, user, body } from './qa-p0-fixtures.mjs';
import { changeNotification } from '../domain/change-notification.js';
import { OPCTimeline } from '../ui/opc.js';
const namespace=new URLSearchParams(location.search).get('validationDb');
if(!/^v04-interaction-[a-z0-9-]+$/.test(namespace??''))throw new Error('Isolated namespace required');
const nativeExtension=location.protocol==='chrome-extension:'&&Boolean(globalThis.chrome?.runtime?.id);
// The native-extension test creates a brand-new profile before opening this
// page. Only that synthetic profile uses the canonical extension DB.
if(!nativeExtension){isolateValidationDatabase(namespace);globalThis.chrome={storage:{local:{async get(key){return {[key]:JSON.parse(localStorage.getItem(namespace+key)??'null')};},async set(values){for(const[k,v]of Object.entries(values))localStorage.setItem(namespace+k,JSON.stringify(v));}}}};}
let simulateNotifications=false,reloads=0;
const api=async(type,args)=>{const result=await command(type,args);if(simulateNotifications&&changeNotification(type,args).event==='changed'&&!document.querySelector('dialog[open]')){setTimeout(()=>{reloads++;timeline.safe(()=>timeline.load())();},0);}return result;};
const errors=[],timeline=new OPCTimeline(document.querySelector('#app'),{api,onError:message=>{errors.push(message);document.querySelector('#status').textContent=message;}});
async function seed(){
  const projectIds=await mutate(state=>[createProject(state,'交互测试 A').id,createProject(state,'交互测试 B').id]);
  for(let c=0;c<3;c++){
    const rows=[];let parent='root';
    for(let i=0;i<6;i++){
      const q=`q-${c}-${i}`,a=`a-${c}-${i}`,text=`真实测试问题 ${c}-${i}：如何验证点击与拖动？\n\n${'完整问题内容。'.repeat(35)}QUESTION-TAIL-${c}_${i}`;
      rows.push([q,parent,user(q,text,1790812800+(c*6+i)*86400)],[a,q,body(a,`# 完整回答 ${c}-${i}\n\n${'这段合成回答必须完整保留。'.repeat(90)}\n\n\`\`\`js\nconst full_answer = ${i};\n\`\`\`\n\n$$x^2+y^2=z^2$$\n\nANSWER-TAIL-${c}_${i}`)]);parent=a;
    }
    const raw=graph(rows,parent,'interaction-source-'+c);raw.title='来源 Conversation '+c;
    const input=(await parseImport(JSON.stringify(raw),'synthetic-interaction.json')).conversations[0];await mutate(state=>saveConversation(state,input,projectIds[c===2?1:0]));
  }
  const state=await readState(),cards=state.qaCards.filter(c=>c.projectId===projectIds[0]).sort((a,b)=>Date.parse(a.questionTime.value)-Date.parse(b.questionTime.value));
  await command('opcWrite',{projectId:projectIds[0],action:'layout',positions:Object.fromEntries(cards.map((c,i)=>[c.id,{x:i%3*320,y:Math.floor(i/3)*270}])),viewport:{x:20,y:20,zoom:1}});
  await command('opcWrite',{projectId:projectIds[0],action:'metadata',cardId:cards[0].id,title:'保留的自定义标题',notes:'这条合成批注应在交互后保持',tags:['保留标签'],expectedRevision:0});
  await command('opcWrite',{projectId:projectIds[0],action:'relationship',fromCardId:cards[0].id,toCardId:cards[1].id,type:'补充',directed:true,description:'原有人工关系必须保留'});
  const workspace=await command('workspaceWrite',{action:'create',name:'两个 Conversation 的 Project'});
  await command('workspaceWrite',{action:'conversations',workspaceId:workspace.id,expectedRevision:0,conversationIds:state.conversations.filter(c=>c.projectId===projectIds[0]).map(c=>c.id)});
  globalThis.interactionTest.original=await readState();await timeline.show({projectId:projectIds[0]});return {projectIds,workspaceId:workspace.id,cards:cards.map(c=>({id:c.id,conversationId:c.conversationId,sourceTitle:c.sourceTitle}))};
}
globalThis.interactionTest={timeline,command,readState,errors,seed,notifications(value){simulateNotifications=value;return reloads;}};document.querySelector('#status').textContent='ready';
