// View preferences are durable, but must not trigger a full workbench rebuild
// in the middle of a pointer gesture. Source/annotation writes still refresh.
export function changeNotification(type, args = {}, result = null) {
  const viewOnly = type === 'releaseWrite' && args.action === 'timelinePreferences' || type === 'opcWrite' && args.action === 'layout';
  // Creation has no projectId in its request. Scope its completed notification
  // to the newly created identity, rather than invalidating every open page.
  // Moving a Conversation changes both projects, so keep that notification global.
  const projectId = type === 'createProject' ? result?.id ?? null : type === 'moveConversation' ? null : args.projectId ?? null;
  return { event: viewOnly ? 'viewChanged' : 'changed', projectId, action: args.action ?? type };
}
