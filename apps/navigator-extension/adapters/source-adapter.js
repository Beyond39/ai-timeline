// This descriptor is derived from the existing normalized capture contract.
// A future adapter must supply observed fields; missing capabilities stay null.
export function sourceDescriptor(capture){return {adapterId:capture.adapterVersion??capture.method??null,platform:capture.platform??null,sourceConversationId:capture.sourceConversationId??null,sourceUrl:capture.sourceUrl??null,
  branchIdentifier:capture.currentPathKey??null,scope:capture.scope??null,messages:(capture.messages??[]).map(m=>({sourceMessageId:m.sourceMessageId??null,sourceParentId:m.sourceParentKey??null,role:m.role??null,messageType:m.readingVisibility??null,createdAt:m.time?.value??null,completion:m.completion??null,content:m.text??'',attachments:m.attachments??[]}))};}
