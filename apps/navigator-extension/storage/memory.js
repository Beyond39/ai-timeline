import { exportWorkspaceData, validateWorkspaceData, libraryChecksumInput } from '../domain/workspace-backup.js';
import { readState, readSnapshot, memoryMetadata, persistRecoveryPoint } from './database.js';
import { id, now, digest, EXTENSION_VERSION, fail } from '../domain/common.js';
import { exportProject, validateBackup } from '../domain/backup.js';

export async function makeRecoveryPoint({ name = '手动保存的资料恢复点', reason = 'manual', upgrade = false } = {}) {
  const state = await readState(), metadata = await memoryMetadata();
  if (state.revision !== metadata.revision) fail('资料已变化，请重试建立恢复点。');
  const projects = state.projects.map(project => exportProject(state, project.id));
  projects.forEach(validateBackup);
  const workspaceData=exportWorkspaceData(state);validateWorkspaceData(workspaceData,projects);
  const point = { id: id('memory'), name: String(name).trim().slice(0, 100) || '本地资料恢复点', reason, createdAt: now(),
    fromVersion: metadata.appVersion ?? '此前版本', toVersion: upgrade ? EXTENSION_VERSION : null, dataRevision: state.revision,
    projectCount: projects.length, conversationCount: state.conversations.length, messageCount: state.messages.length, projects, workspaceData };
  point.checksum = await digest(libraryChecksumInput(projects,workspaceData));
  await persistRecoveryPoint(point, { expectedRevision: state.revision, appVersion: upgrade ? EXTENSION_VERSION : null });
  const { projects: bodies, workspaceData: organization, ...header } = point; return header;
}
export async function initializeMemory() {
  const metadata = await memoryMetadata();
  if (metadata.appVersion === EXTENSION_VERSION) return { initialized: true, upgraded: false, version: EXTENSION_VERSION };
  const counts = await readSnapshot([{ store: 'projects', mode: 'count', name: 'projectCount' }]);
  if (counts.projectCount) {
    const point = await makeRecoveryPoint({ name: `更新至 ${EXTENSION_VERSION} 前的资料`, reason: 'version_upgrade', upgrade: true });
    return { initialized: true, upgraded: true, version: EXTENSION_VERSION, recoveryPoint: point };
  }
  await persistRecoveryPoint(null, { expectedRevision: counts.revision, appVersion: EXTENSION_VERSION });
  return { initialized: true, upgraded: false, version: EXTENSION_VERSION };
}
export async function memoryStatus() {
  const result = await readSnapshot([{ store: 'projects', mode: 'count', name: 'projects' }, { store: 'conversations', mode: 'count', name: 'conversations' },
    { store: 'messages', mode: 'count', name: 'messages' }, { store: 'versions', mode: 'count', name: 'versions' },
    { store: 'recoveryPoints', name: 'points', project: row => ({ id: row.id, name: row.name, reason: row.reason, createdAt: row.createdAt, fromVersion: row.fromVersion,
      toVersion: row.toVersion, projectCount: row.projectCount, conversationCount: row.conversationCount, messageCount: row.messageCount, checksum: row.checksum }) }]);
  const metadata = await memoryMetadata();
  return { ...result, version: EXTENSION_VERSION, databaseVersion: metadata.databaseVersion, points: result.points.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
export async function readRecoveryPoint(pointId) {
  const result = await readSnapshot([{ store: 'recoveryPoints', key: pointId, mode: 'get', name: 'point' }]), point = result.point;
  if (!point || !Array.isArray(point.projects) || point.checksum !== await digest(libraryChecksumInput(point.projects,point.workspaceData))) fail('恢复点不存在或内容校验失败，当前资料没有改变。');
  point.projects.forEach(validateBackup);validateWorkspaceData(point.workspaceData,point.projects); return point;
}
