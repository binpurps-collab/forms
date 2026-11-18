import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import type { FolderNode } from '../types/forms';

interface FolderTreeProps {
  root: FolderNode;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
}

interface TreeBranchProps {
  node: FolderNode;
  depth: number;
  selectedPath: string;
  expandedPaths: Set<string>;
  onSelectFolder: (path: string) => void;
  onToggleExpand: (path: string) => void;
}

function TreeBranch({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelectFolder,
  onToggleExpand,
}: TreeBranchProps) {
  const isSelected = selectedPath === node.path;
  const hasChildren = node.subfolders.length > 0;
  const isExpanded = expandedPaths.has(node.path) || selectedPath.startsWith(node.path + '/');

  return (
    <li>
      <div
        className={`group flex items-center justify-between rounded-md transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-800 font-medium'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px`, paddingRight: '10px' }}
      >
        <div className="flex items-center min-w-0 flex-1 py-2 gap-1.5">
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.path);
              }}
              aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-600 shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4.5 shrink-0" aria-hidden="true" />
          )}

          <button
            type="button"
            onClick={() => onSelectFolder(node.path)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
          >
            {isSelected || isExpanded ? (
              <FolderOpen
                className={`w-4 h-4 shrink-0 ${
                  isSelected ? 'text-blue-700' : 'text-slate-400 group-hover:text-slate-600'
                }`}
              />
            ) : (
              <Folder className="w-4 h-4 shrink-0 text-slate-400 group-hover:text-slate-600" />
            )}
            <span className="truncate">{node.label}</span>
          </button>
        </div>

        <span
          className={`text-xs font-mono tabular-nums pl-2 shrink-0 ${
            isSelected ? 'text-blue-700' : 'text-slate-400'
          }`}
        >
          {node.recursiveFileCount}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <ul className="mt-0.5 space-y-0.5">
          {node.subfolders.map((sub) => (
            <TreeBranch
              key={sub.path}
              node={sub}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelectFolder={onSelectFolder}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree({
  root,
  selectedPath,
  expandedPaths,
  onSelectFolder,
  onToggleExpand,
}: FolderTreeProps) {
  const isRootSelected = selectedPath === '';

  return (
    <nav aria-label="Folder directory">
      <div className="mb-2 px-2 flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Directory Tree</span>
        <span className="text-xs font-mono tabular-nums text-slate-400">
          {root.recursiveFileCount} files
        </span>
      </div>

      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelectFolder('')}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
              isRootSelected
                ? 'bg-blue-50 text-blue-800 font-medium'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <FolderOpen
                className={`w-4 h-4 shrink-0 ${isRootSelected ? 'text-blue-700' : 'text-slate-400'}`}
              />
              <span className="truncate">All Forms (Root)</span>
            </span>
            <span
              className={`text-xs font-mono tabular-nums shrink-0 ${
                isRootSelected ? 'text-blue-700' : 'text-slate-400'
              }`}
            >
              {root.recursiveFileCount}
            </span>
          </button>
        </li>

        {root.subfolders.map((folder) => (
          <TreeBranch
            key={folder.path}
            node={folder}
            depth={0}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onSelectFolder={onSelectFolder}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </ul>
    </nav>
  );
}
