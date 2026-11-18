import { ArrowLeft, FolderTree as FolderTreeIcon, Eye, Package, ServerOff } from 'lucide-react';
import type { FormsManifest } from '../types/forms';
import { formatBytes } from '../utils/formatters';

interface ArchitectureGuideProps {
  manifest: FormsManifest;
  onBackToFiles: () => void;
}

export function ArchitectureGuide({ manifest, onBackToFiles }: ArchitectureGuideProps) {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
            Static Folder-to-Portal Architecture
          </h1>
          <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
            This website runs with zero backend servers or databases. Files dropped into{' '}
            <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-800">
              public/forms/
            </code>{' '}
            and its nested subfolders are automatically discovered at dev and build time.
          </p>
        </div>

        <button
          type="button"
          onClick={onBackToFiles}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Forms</span>
        </button>
      </div>

      {/* Key Architectural Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2.5">
          <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
            <FolderTreeIcon className="w-4 h-4 text-blue-700" />
            <span>01. Automatic Folder Discovery</span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            A custom Vite build plugin recursively walks{' '}
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">public/forms/</code>,
            reads real file sizes and timestamps, extracts optional form codes (such as{' '}
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">HR-101</code>), and
            generates both a virtual module and a static{' '}
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">forms-manifest.json</code>.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2.5">
          <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
            <Eye className="w-4 h-4 text-blue-700" />
            <span>02. In-Browser Online Viewing</span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            PDF forms render directly in the browser via{' '}
            <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">pdfjs-dist</code>{' '}
            with page navigation and zoom, alongside a toggle for native browser PDF viewing. CSV
            schedules and text guidelines render inline without extra downloads.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2.5">
          <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
            <Package className="w-4 h-4 text-blue-700" />
            <span>03. Client-Side Folder ZIP Bundles</span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Users can download individual PDFs or package an entire folder and all its subfolders
            into a standard <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">.zip</code>{' '}
            archive assembled in-memory in the browser.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-2.5">
          <div className="flex items-center gap-2.5 text-slate-900 font-semibold text-sm">
            <ServerOff className="w-4 h-4 text-blue-700" />
            <span>04. Pure Static Hosting Ready</span>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Running <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">npm run build</code>{' '}
            outputs a self-contained static <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">dist/</code>{' '}
            directory deployable to GitHub Pages, Cloudflare Pages, Netlify, Vercel, or any Nginx/S3 static host.
          </p>
        </div>
      </div>

      {/* Live Indexed Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-base font-semibold text-slate-900">Current Indexed Directory Snapshot</h2>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-6 border-t border-slate-100 pt-4">
          <div>
            <div className="text-xs text-slate-500">Root Source</div>
            <div className="mt-1 text-sm font-mono font-medium text-slate-900">{manifest.rootDirectory}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Detected Folders</div>
            <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900">
              {manifest.totalFolders}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Indexed Files</div>
            <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900">
              {manifest.totalFiles}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Total Payload</div>
            <div className="mt-1 text-sm font-mono tabular-nums font-medium text-slate-900">
              {formatBytes(manifest.totalBytes)}
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="text-xs font-medium text-slate-500 mb-2">How to Add New Forms</div>
          <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-lg overflow-x-auto leading-relaxed">
{`1. Drop any PDF or folder inside:
   public/forms/<Department>/<Subfolder>/<FORM-CODE>-Form-Name.pdf

2. Optional numeric prefixes like "01-Human-Resources/" control sidebar order
   while automatically displaying cleanly as "Human Resources".

3. Rebuild or push to Git — the static manifest updates automatically:
   npm run build`}
          </pre>
        </div>
      </div>
    </div>
  );
}
