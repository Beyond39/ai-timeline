import { isolateValidationDatabase } from './isolated-db.js';
import { command, mutate } from '../storage/repository.js';
import { readState } from '../storage/database.js';
import { saveConversation, createProject } from '../domain/captures.js';
import { parseImport } from '../importers/json.js';
import { graph, user, body } from './qa-p0-fixtures.mjs';
import { projectConversations } from './project-fixtures.mjs';
import { OPCTimeline } from '../ui/opc.js';
const label=new URLSearchParams(location.search).get('validationDb');
if(!/^v04-project-[a-z0-9-]+$/.test(label??''))throw new Error('isolated database required');
isolateValidationDatabase(label);
globalThis.chrome={storage:{local:{async get(key){return {[key]:JSON.parse(localStorage.getItem(label+key)??'null')};},async set(values){for(const[k,v]of Object.entries(values))localStorage.setItem(label+k,JSON.stringify(v));}}}};
const errors=[];
const timeline=new OPCTimeline(document.querySelector('#app'),{api:command,onError:error=>{errors.push(error);document.querySelector('#results').textContent=error;}});
const inputs=[];
async function seed(){
  // Seed through the actual Git baseline's v8 database implementation. Opening
  // current storage afterwards exercises a real additive v8 -> v9 migration.
  const legacy=await import('../dist/project-v8/storage/database.js');
  const legacyMutate=async run=>{const before=await legacy.readState(),after=structuredClone(before);const result=await run(after);await legacy.commit(before,after);return result;};
  const projects=[];
  for(const conversation of projectConversations()){
    let parent='root';const rows=[];
    for(let i=0;i<conversation.messages.length;i+=2){const q=conversation.messages[i],a=conversation.messages[i+1];rows.push([q.sourceMessageId,parent,user(q.sourceMessageId,q.text,Date.parse(q.time.value)/1000)],[a.sourceMessageId,q.sourceMessageId,body(a.sourceMessageId,a.text)]);parent=a.sourceMessageId;}
    const raw=graph(rows,parent,conversation.sourceConversationId);raw.title=conversation.title;
    const input=(await parseImport(JSON.stringify(raw),'synthetic-project.json')).conversations[0];inputs.push(input);
    const projectId=await legacyMutate(s=>createProject(s,conversation.title+' 来源').id);projects.push(projectId);
    await legacyMutate(s=>saveConversation(s,input,projectId));
  }
  const beforeUpgrade=await legacy.readState();
  const afterUpgrade=await readState();
  for(const store of legacy.STORES)if(JSON.stringify(beforeUpgrade[store])!==JSON.stringify(afterUpgrade[store]))throw new Error('v8 -> v9 changed source store '+store);
  await command('memoryInitialize',{});
  await timeline.show({projectId:projects[0]});return readState();
}
globalThis.workspaceTest={command,readState,mutate,timeline,errors,seed,async reimport(){for(const input of inputs)await mutate(s=>saveConversation(s,input,s.conversations.find(c=>c.sourceConversationId===input.sourceConversationId).projectId));},async ready(){const s=await readState();if(s.projects.length)await timeline.show({projectId:s.projects[0].id});return s;}};
document.querySelector('#results').textContent='ready';
