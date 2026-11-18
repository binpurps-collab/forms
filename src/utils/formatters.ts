import type { DocumentFile, FolderNode } from '../types/forms';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value < 10 && exponent > 0 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}

export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function findFolderByPath(root: FolderNode, targetPath: string): FolderNode | null {
  if (!targetPath) return root;
  if (root.path === targetPath) return root;
  for (const sub of root.subfolders) {
    const found = findFolderByPath(sub, targetPath);
    if (found) return found;
  }
  return null;
}

export function buildFolderBreadcrumbs(root: FolderNode, targetPath: string): FolderNode[] {
  if (!targetPath) return [root];
  const segments = targetPath.split('/').filter(Boolean);
  const trail: FolderNode[] = [root];
  let current = root;
  let accumulated = '';

  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    const next = current.subfolders.find((sub) => sub.path === accumulated);
    if (!next) break;
    trail.push(next);
    current = next;
  }

  return trail;
}

export function collectFilesRecursive(folder: FolderNode): DocumentFile[] {
  const list: DocumentFile[] = [...folder.files];
  for (const sub of folder.subfolders) {
    list.push(...collectFilesRecursive(sub));
  }
  return list;
}

export function triggerDirectDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
