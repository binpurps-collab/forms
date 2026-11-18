import fs from 'fs';
import path from 'path';
import type { Plugin, ViteDevServer } from 'vite';
import type { DocumentFile, FolderNode, FormsManifest, MimeCategory } from './src/types/forms';

const VIRTUAL_MODULE_ID = 'virtual:forms-manifest';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

const UPPERCASE_WORDS = new Set(['HR', 'IT', 'VPN', 'NDA', 'PDF', 'CSV', 'W9', 'TAX', 'DPA', 'ACH', 'ID']);
const LOWERCASE_CONNECTORS = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'on', 'with']);

function formatSegmentLabel(rawName: string): { label: string; sortOrder: number } {
  const prefixMatch = rawName.match(/^(\d+)[-_.\s]+(.+)$/);
  const sortOrder = prefixMatch ? parseInt(prefixMatch[1], 10) : 9999;
  const cleanRaw = prefixMatch ? prefixMatch[2] : rawName;

  const words = cleanRaw
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const formatted = words
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (UPPERCASE_WORDS.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (idx > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');

  return { label: formatted || rawName, sortOrder };
}

function parseFilename(rawFilename: string): {
  title: string;
  formCode: string | null;
  ext: string;
} {
  const extWithDot = path.extname(rawFilename);
  const ext = extWithDot.replace(/^\./, '').toLowerCase() || 'file';
  const baseName = path.basename(rawFilename, extWithDot);

  // Detect optional form code prefix like HR-101, FIN-304, LEG-701, FORM-12
  const codeMatch = baseName.match(/^([A-Za-z]{2,6}-\d{2,5})[-_\s]+(.+)$/);
  const formCode = codeMatch ? codeMatch[1].toUpperCase() : null;
  const titleSource = codeMatch ? codeMatch[2] : baseName;

  const words = titleSource
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const title = words
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (UPPERCASE_WORDS.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (idx > 0 && LOWERCASE_CONNECTORS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');

  return {
    title: title || baseName,
    formCode,
    ext,
  };
}

function getMimeCategory(ext: string): { category: MimeCategory; previewable: boolean } {
  switch (ext) {
    case 'pdf':
      return { category: 'pdf', previewable: true };
    case 'csv':
    case 'xlsx':
    case 'xls':
      return { category: 'spreadsheet', previewable: ext === 'csv' };
    case 'txt':
    case 'md':
    case 'json':
    case 'log':
      return { category: 'text', previewable: true };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'svg':
    case 'gif':
      return { category: 'image', previewable: true };
    case 'zip':
    case 'tar':
    case 'gz':
      return { category: 'archive', previewable: false };
    default:
      return { category: 'other', previewable: false };
  }
}

export function scanFormsDirectory(formsDir: string, urlPrefix = '/forms'): FormsManifest {
  const allFiles: DocumentFile[] = [];
  let totalFolders = 0;
  let totalBytes = 0;

  function scanNode(absDir: string, relPath: string, breadcrumbLabels: string[]): FolderNode {
    const rawName = relPath ? path.posix.basename(relPath) : 'forms';
    const { label, sortOrder } = relPath
      ? formatSegmentLabel(rawName)
      : { label: 'All Forms', sortOrder: 0 };

    const entries = fs.existsSync(absDir)
      ? fs.readdirSync(absDir, { withFileTypes: true })
      : [];

    const subfolders: FolderNode[] = [];
    const files: DocumentFile[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const childAbs = path.join(absDir, entry.name);
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        totalFolders += 1;
        const { label: childLabel } = formatSegmentLabel(entry.name);
        const childNode = scanNode(childAbs, childRel, [...breadcrumbLabels, childLabel]);
        subfolders.push(childNode);
      } else if (entry.isFile()) {
        const stat = fs.statSync(childAbs);
        const { title, formCode, ext } = parseFilename(entry.name);
        const { category, previewable } = getMimeCategory(ext);
        const encodedSegments = childRel.split('/').map(encodeURIComponent).join('/');
        const folderLabel = breadcrumbLabels.length > 0 ? breadcrumbLabels.join(' / ') : 'Root Directory';

        const fileItem: DocumentFile = {
          id: childRel,
          filename: entry.name,
          title,
          formCode,
          ext,
          mimeCategory: category,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          folderPath: relPath,
          folderLabel,
          url: `${urlPrefix}/${encodedSegments}`,
          previewable,
        };

        files.push(fileItem);
        allFiles.push(fileItem);
        totalBytes += stat.size;
      }
    }

    subfolders.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    files.sort((a, b) => a.filename.localeCompare(b.filename));

    const recursiveFileCount =
      files.length + subfolders.reduce((acc, sub) => acc + sub.recursiveFileCount, 0);

    return {
      path: relPath,
      name: rawName,
      label,
      sortOrder,
      subfolders,
      files,
      recursiveFileCount,
    };
  }

  const root = scanNode(formsDir, '', []);

  return {
    generatedAt: new Date().toISOString(),
    rootDirectory: 'public/forms',
    totalFiles: allFiles.length,
    totalFolders,
    totalBytes,
    root,
    allFiles,
  };
}

export function formsDirectoryManifestPlugin(relativeFormsDir = 'public/forms'): Plugin {
  let projectRoot = process.cwd();

  const getFormsDir = () => path.resolve(projectRoot, relativeFormsDir);

  return {
    name: 'forms-directory-manifest',

    configResolved(config) {
      projectRoot = config.root;
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const manifest = scanFormsDirectory(getFormsDir());
        return `export default ${JSON.stringify(manifest)};`;
      }
      return null;
    },

    configureServer(server: ViteDevServer) {
      const formsDir = getFormsDir();

      // Serve live JSON manifest on /forms-manifest.json in dev mode
      server.middlewares.use('/forms-manifest.json', (_req, res) => {
        const manifest = scanFormsDirectory(formsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(manifest, null, 2));
      });

      // Trigger virtual module invalidation when files/folders in public/forms change
      const invalidateManifest = (changedPath: string) => {
        if (changedPath.startsWith(formsDir)) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
      };

      server.watcher.on('add', invalidateManifest);
      server.watcher.on('unlink', invalidateManifest);
      server.watcher.on('addDir', invalidateManifest);
      server.watcher.on('unlinkDir', invalidateManifest);
    },

    generateBundle() {
      const manifest = scanFormsDirectory(getFormsDir());
      this.emitFile({
        type: 'asset',
        fileName: 'forms-manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}
