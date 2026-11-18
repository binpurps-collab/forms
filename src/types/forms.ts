export type MimeCategory =
  | 'pdf'
  | 'spreadsheet'
  | 'text'
  | 'image'
  | 'archive'
  | 'other';

export interface DocumentFile {
  id: string;
  filename: string;
  title: string;
  formCode: string | null;
  ext: string;
  mimeCategory: MimeCategory;
  sizeBytes: number;
  modifiedAt: string;
  folderPath: string;
  folderLabel: string;
  url: string;
  previewable: boolean;
}

export interface FolderNode {
  path: string;
  name: string;
  label: string;
  sortOrder: number;
  subfolders: FolderNode[];
  files: DocumentFile[];
  recursiveFileCount: number;
}

export interface FormsManifest {
  generatedAt: string;
  rootDirectory: string;
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  root: FolderNode;
  allFiles: DocumentFile[];
}
