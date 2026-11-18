import {
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  Menu,
  Package,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import manifest from 'virtual:forms-manifest';
import { ArchitectureGuide } from './components/ArchitectureGuide';
import { DocumentViewerModal } from './components/DocumentViewerModal';
import { FolderTree } from './components/FolderTree';
import type { DocumentFile, FolderNode } from './types/forms';
import {
  buildFolderBreadcrumbs,
  collectFilesRecursive,
  findFolderByPath,
  formatBytes,
  formatShortDate,
  triggerDirectDownload,
} from './utils/formatters';
import { createZipBlob } from './utils/zipBuilder';

type NavSection = 'forms' | 'recent' | 'architecture';
type TypeFilter = 'all' | 'pdf' | 'other';
type SortOption = 'name' | 'newest' | 'size';
type ViewMode = 'list' | 'grid';

function getInitialFolderFromHash(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash;
  if (hash.startsWith('#folder=')) {
    const decoded = decodeURIComponent(hash.slice('#folder='.length));
    if (findFolderByPath(manifest.root, decoded)) {
      return decoded;
    }
  }
  return '';
}

function FileTypeIcon({ file }: { file: DocumentFile }) {
  if (file.mimeCategory === 'spreadsheet') {
    return <FileSpreadsheet className="w-4.5 h-4.5 text-emerald-700 shrink-0" />;
  }
  if (file.ext === 'pdf') {
    return <FileText className="w-4.5 h-4.5 text-blue-700 shrink-0" />;
  }
  return <FileText className="w-4.5 h-4.5 text-slate-500 shrink-0" />;
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('forms');
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>(getInitialFolderFromHash);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const top of manifest.root.subfolders) {
      initial.add(top.path);
    }
    return initial;
  });

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [previewFile, setPreviewFile] = useState<DocumentFile | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [zipProgress, setZipProgress] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sync folder selection with URL hash
  useEffect(() => {
    const nextHash = selectedFolderPath
      ? `#folder=${encodeURIComponent(selectedFolderPath)}`
      : '';
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash || window.location.pathname);
    }
  }, [selectedFolderPath]);

  // Global keyboard shortcut (Cmd/Ctrl+K or /) to focus search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveNav('forms');
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        !previewFile
      ) {
        e.preventDefault();
        setActiveNav('forms');
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewFile]);

  const currentFolder: FolderNode = useMemo(() => {
    return findFolderByPath(manifest.root, selectedFolderPath) ?? manifest.root;
  }, [selectedFolderPath]);

  const breadcrumbs: FolderNode[] = useMemo(() => {
    return buildFolderBreadcrumbs(manifest.root, currentFolder.path);
  }, [currentFolder.path]);

  const scopedFiles = useMemo(() => {
    const baseFiles =
      activeNav === 'recent'
        ? manifest.allFiles
        : collectFilesRecursive(currentFolder);

    const query = searchQuery.trim().toLowerCase();

    const filtered = baseFiles.filter((file) => {
      if (typeFilter === 'pdf' && file.ext !== 'pdf') return false;
      if (typeFilter === 'other' && file.ext === 'pdf') return false;

      if (!query) return true;
      return (
        file.title.toLowerCase().includes(query) ||
        file.filename.toLowerCase().includes(query) ||
        (file.formCode && file.formCode.toLowerCase().includes(query)) ||
        file.folderLabel.toLowerCase().includes(query)
      );
    });

    const sorted = [...filtered];
    if (sortBy === 'newest' || activeNav === 'recent') {
      sorted.sort(
        (a, b) =>
          new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime() ||
          a.filename.localeCompare(b.filename)
      );
    } else if (sortBy === 'size') {
      sorted.sort((a, b) => b.sizeBytes - a.sizeBytes || a.filename.localeCompare(b.filename));
    } else {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    }

    return sorted;
  }, [activeNav, currentFolder, searchQuery, typeFilter, sortBy]);

  const handleSelectFolder = (path: string) => {
    setSelectedFolderPath(path);
    setActiveNav('forms');
    setMobileMenuOpen(false);
    if (path) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        const parts = path.split('/');
        let acc = '';
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p;
          next.add(acc);
        }
        return next;
      });
    }
  };

  const handleToggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleDownloadFolderZip = async () => {
    const targetFiles =
      activeNav === 'recent' ? scopedFiles : collectFilesRecursive(currentFolder);
    if (targetFiles.length === 0 || zipProgress) return;

    try {
      setZipProgress(`Bundling ${targetFiles.length} files...`);
      const entries = await Promise.all(
        targetFiles.map(async (file) => {
          const response = await fetch(file.url);
          if (!response.ok) {
            throw new Error(`Failed to fetch ${file.filename}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          const basePrefix = currentFolder.path ? currentFolder.path + '/' : '';
          const relativePath = file.id.startsWith(basePrefix)
            ? file.id.slice(basePrefix.length)
            : file.id;

          return {
            relativePath,
            data: new Uint8Array(arrayBuffer),
            modifiedAt: new Date(file.modifiedAt),
          };
        })
      );

      const blob = createZipBlob(entries);
      const blobUrl = URL.createObjectURL(blob);
      const archiveName = currentFolder.path
        ? `${currentFolder.name}-forms.zip`
        : 'all-forms-archive.zip';
      triggerDirectDownload(blobUrl, archiveName);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
    } catch {
      // Fallback silently handled by clearing progress
    } finally {
      setZipProgress(null);
    }
  };

  const showSubfolders =
    activeNav === 'forms' &&
    currentFolder.subfolders.length > 0 &&
    searchQuery.trim() === '' &&
    typeFilter === 'all';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open directory menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedFolderPath('');
                setSearchQuery('');
                setTypeFilter('all');
                setActiveNav('forms');
              }}
              className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
            >
              CivicForms Archive
            </button>
          </div>

          {/* Zone 2: Concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setSelectedFolderPath('');
                setSearchQuery('');
                setTypeFilter('all');
                setSortBy('name');
                setActiveNav('forms');
              }}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeNav === 'forms' && selectedFolderPath === ''
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              All Forms
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveNav('forms');
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  setMobileMenuOpen(true);
                }
              }}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeNav === 'forms' && selectedFolderPath !== ''
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Directory
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveNav('recent');
                setSortBy('newest');
              }}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeNav === 'recent'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Recent Updates
            </button>

            <button
              type="button"
              onClick={() => setActiveNav('architecture')}
              className={`py-1 whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeNav === 'architecture'
                  ? 'border-blue-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Static Setup
            </button>
          </nav>

          {/* Zone 3: Single primary action button */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleDownloadFolderZip}
              disabled={Boolean(zipProgress)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <Package className="w-3.5 h-3.5" />
              <span>
                {zipProgress
                  ? zipProgress
                  : currentFolder.path
                  ? 'Download Folder (.zip)'
                  : 'Download All (.zip)'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      {activeNav === 'architecture' ? (
        <main className="flex-1">
          <ArchitectureGuide manifest={manifest} onBackToFiles={() => setActiveNav('forms')} />
        </main>
      ) : (
        <div className="flex-1 max-w-[1440px] w-full mx-auto flex">
          {/* Desktop Sidebar */}
          <aside className="hidden lg:flex flex-col w-72 shrink-0 border-r border-slate-200 bg-white px-4 py-6 justify-between">
            <div className="overflow-y-auto">
              <FolderTree
                root={manifest.root}
                selectedPath={selectedFolderPath}
                expandedPaths={expandedPaths}
                onSelectFolder={handleSelectFolder}
                onToggleExpand={handleToggleExpand}
              />
            </div>

            <div className="mt-8 pt-4 border-t border-slate-100 px-2 text-xs text-slate-500 space-y-1">
              <div className="font-medium text-slate-700">Auto-Indexed Directory</div>
              <div className="font-mono text-[11px] text-slate-400 truncate">
                {manifest.rootDirectory}/
              </div>
              <div className="tabular-nums text-slate-500">
                {manifest.totalFolders} folders · {manifest.totalFiles} files ·{' '}
                {formatBytes(manifest.totalBytes)}
              </div>
            </div>
          </aside>

          {/* Mobile Folder Drawer */}
          {mobileMenuOpen && (
            <div
              className="fixed inset-0 z-40 lg:hidden flex bg-slate-950/50"
              onClick={() => setMobileMenuOpen(false)}
            >
              <aside
                className="w-80 max-w-[85vw] bg-white h-full border-r border-slate-200 p-4 flex flex-col justify-between overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div>
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                    <span className="font-display font-semibold text-sm text-slate-900">
                      Folders &amp; Navigation
                    </span>
                    <button
                      type="button"
                      onClick={() => setMobileMenuOpen(false)}
                      aria-label="Close directory menu"
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-4 pb-3 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveNav('forms');
                        setSelectedFolderPath('');
                        setMobileMenuOpen(false);
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700"
                    >
                      All Forms
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveNav('recent');
                        setSortBy('newest');
                        setMobileMenuOpen(false);
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700"
                    >
                      Recent
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveNav('architecture');
                        setMobileMenuOpen(false);
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700"
                    >
                      Static Setup
                    </button>
                  </div>

                  <FolderTree
                    root={manifest.root}
                    selectedPath={selectedFolderPath}
                    expandedPaths={expandedPaths}
                    onSelectFolder={handleSelectFolder}
                    onToggleExpand={handleToggleExpand}
                  />
                </div>
              </aside>
            </div>
          )}

          {/* Main Document Workspace */}
          <main className="flex-1 min-w-0 px-4 sm:px-8 py-6 sm:py-8 space-y-6">
            {/* Workspace Header + Breadcrumbs */}
            <div className="space-y-2">
              {activeNav === 'recent' ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>All Repositories</span>
                  <span aria-hidden="true">/</span>
                  <span className="text-slate-900 font-medium">Recently Updated</span>
                </div>
              ) : (
                <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs">
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1;
                    return (
                      <div key={crumb.path || 'root'} className="flex items-center gap-1.5">
                        {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                        <button
                          type="button"
                          onClick={() => handleSelectFolder(crumb.path)}
                          className={`rounded px-1 py-0.5 transition-colors ${
                            isLast
                              ? 'text-slate-900 font-medium'
                              : 'text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {crumb.label}
                        </button>
                      </div>
                    );
                  })}
                </nav>
              )}

              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
                    {activeNav === 'recent'
                      ? 'Recently Updated Documents'
                      : currentFolder.label}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    {activeNav === 'recent'
                      ? 'Latest PDF forms and reference documents across all indexed folders.'
                      : currentFolder.path
                      ? `Browsing folder ${currentFolder.path} · ${currentFolder.recursiveFileCount} available files`
                      : `Browse ${manifest.totalFiles} forms organized across ${manifest.totalFolders} folders and subfolders. Preview online or download immediately.`}
                  </p>
                </div>
              </div>
            </div>

            {/* Search, Segmented Filter & View Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search forms by name, code (e.g. HR-101), or folder..."
                  className="w-full pl-9 pr-16 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-2 focus:outline-blue-600 focus:border-transparent"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <span className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 pointer-events-none">
                    /
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {/* Segmented File Type Tabs */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All Files' },
                      { id: 'pdf', label: 'PDF Forms' },
                      { id: 'other', label: 'Data & Text' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTypeFilter(tab.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        typeFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Sort Dropdown */}
                <select
                  aria-label="Sort documents"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-2 focus:outline-blue-600"
                >
                  <option value="name">Sort: Name</option>
                  <option value="newest">Sort: Newest</option>
                  <option value="size">Sort: File Size</option>
                </select>

                {/* View Mode Toggle */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    aria-label="List view"
                    className={`p-1.5 rounded-md transition-colors ${
                      viewMode === 'list'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    aria-label="Grid view"
                    className={`p-1.5 rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Subfolders Section */}
            {showSubfolders && (
              <section aria-label="Subfolders" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Subfolders ({currentFolder.subfolders.length})
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {currentFolder.subfolders.map((sub) => (
                    <button
                      key={sub.path}
                      type="button"
                      onClick={() => handleSelectFolder(sub.path)}
                      className="group flex items-center justify-between gap-3 p-3.5 bg-white border border-slate-200 rounded-xl text-left hover:border-blue-300 hover:bg-blue-50/30 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Folder className="w-5 h-5 text-blue-700 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate group-hover:text-blue-800">
                            {sub.label}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {sub.recursiveFileCount}{' '}
                            {sub.recursiveFileCount === 1 ? 'file' : 'files'}
                            {sub.subfolders.length > 0 &&
                              ` · ${sub.subfolders.length} ${
                                sub.subfolders.length === 1 ? 'subfolder' : 'subfolders'
                              }`}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-700 shrink-0" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Documents Section */}
            <section aria-label="Documents" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Documents ({scopedFiles.length})
                </h2>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-xs text-blue-700 hover:underline"
                  >
                    Clear search
                  </button>
                )}
              </div>

              {scopedFiles.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                  <FolderOpen className="w-9 h-9 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-base font-medium text-slate-900">No matching documents found</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Try adjusting your search query, switching file filters, or browsing another folder.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setTypeFilter('all');
                      setSelectedFolderPath('');
                    }}
                    className="mt-4 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : viewMode === 'list' ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-medium text-slate-500">
                          <th className="py-3 pl-5 pr-4">Document</th>
                          <th className="py-3 px-4 hidden md:table-cell">Folder</th>
                          <th className="py-3 px-4 text-right hidden sm:table-cell">Size</th>
                          <th className="py-3 px-4 text-right hidden xl:table-cell">Updated</th>
                          <th className="py-3 pl-4 pr-5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {scopedFiles.map((file) => (
                          <tr
                            key={file.id}
                            className="group hover:bg-slate-50/90 transition-colors"
                          >
                            <td className="py-3.5 pl-5 pr-4">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="mt-0.5">
                                  <FileTypeIcon file={file} />
                                </div>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewFile(file)}
                                    className="text-sm font-medium text-slate-900 hover:text-blue-700 text-left focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
                                  >
                                    {file.title}
                                  </button>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                    {file.formCode && (
                                      <>
                                        <span className="font-mono text-slate-700">{file.formCode}</span>
                                        <span aria-hidden="true">·</span>
                                      </>
                                    )}
                                    <span className="uppercase font-mono">{file.ext}</span>
                                    <span className="sm:hidden" aria-hidden="true">·</span>
                                    <span className="sm:hidden font-mono tabular-nums">
                                      {formatBytes(file.sizeBytes)}
                                    </span>
                                    <span className="md:hidden" aria-hidden="true">·</span>
                                    <span className="md:hidden truncate max-w-[200px]">
                                      {file.folderLabel}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-xs text-slate-600 hidden md:table-cell">
                              <button
                                type="button"
                                onClick={() => handleSelectFolder(file.folderPath)}
                                className="hover:text-blue-700 hover:underline text-left"
                              >
                                {file.folderLabel}
                              </button>
                            </td>

                            <td className="py-3.5 px-4 text-right text-xs font-mono tabular-nums text-slate-600 whitespace-nowrap hidden sm:table-cell">
                              {formatBytes(file.sizeBytes)}
                            </td>

                            <td className="py-3.5 px-4 text-right text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap hidden xl:table-cell">
                              {formatShortDate(file.modifiedAt)}
                            </td>

                            <td className="py-3.5 pl-4 pr-5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setPreviewFile(file)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View</span>
                                </button>

                                <a
                                  href={file.url}
                                  download={file.filename}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download</span>
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {scopedFiles.map((file) => (
                    <article
                      key={file.id}
                      className="flex flex-col justify-between bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{file.folderLabel}</span>
                          <span className="font-mono uppercase shrink-0">{file.ext}</span>
                        </div>

                        <h3 className="mt-2.5 text-base font-semibold text-slate-900 leading-snug">
                          <button
                            type="button"
                            onClick={() => setPreviewFile(file)}
                            className="text-left hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600 rounded"
                          >
                            {file.title}
                          </button>
                        </h3>

                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                          {file.formCode && (
                            <>
                              <span className="text-slate-700">{file.formCode}</span>
                              <span aria-hidden="true">·</span>
                            </>
                          )}
                          <span>{formatBytes(file.sizeBytes)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatShortDate(file.modifiedAt)}</span>
                        </div>
                      </div>

                      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewFile(file)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Online</span>
                        </button>
                        <a
                          href={file.url}
                          download={file.filename}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </main>
        </div>
      )}

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div>CivicForms Archive · Static Folder-Indexed Document Repository</div>
          <div className="flex items-center gap-4">
            <a
              href="/forms-manifest.json"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-900 transition-colors"
            >
              Static JSON Manifest
            </a>
            <button
              type="button"
              onClick={() => setActiveNav('architecture')}
              className="hover:text-slate-900 transition-colors"
            >
              Architecture Guide
            </button>
          </div>
        </div>
      </footer>

      {/* Online In-Browser Document Viewer */}
      <DocumentViewerModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
