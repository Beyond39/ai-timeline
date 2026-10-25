import { readSnapshot, commit } from './database.js';
import { conversationLibrary, manageConversations } from '../domain/conversation-management.js';
export async function loadConversationLibrary(args) { const data=await readSnapshot(['projects','conversations','qaCards'].map(store=>({store})));return conversationLibrary(data,args); }
export async function writeConversationManagement(args) {
  const before=await readSnapshot([{store:'projects'}, {store:'conversations'}]),after=structuredClone(before);
  const result=manageConversations(after,args);await commit(before,after);return result;
}
