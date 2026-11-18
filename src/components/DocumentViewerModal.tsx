import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { DocumentFile } from '../types/forms';
import { formatBytes, formatShortDate, triggerDirectDownload } from '../utils/formatters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface DocumentViewerModalProps {
  file: DocumentFile | null;
  onClose: () => void;
}

function parseCsvRows(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

export function DocumentViewerModal({ file, onClose }: DocumentViewerModalProps) {
  const [pdfRenderMode, setPdfRenderMode] = useState<'canvas' | 'native'>('canvas');
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  // Reset state when switching file
  useEffect(() => {
    if (!file) return;
    setCurrentPage(1);
    setNumPages(0);
    setZoom(1.15);
    setErrorMsg(null);
    setTextContent(null);
    setCopiedLink(false);
    setPdfRenderMode('canvas');
  }, [file]);

  // Escape & arrow keyboard shortcuts
  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (file.ext === 'pdf' && pdfRenderMode === 'canvas') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          setCurrentPage((p) => Math.min(numPages || 1, p + 1));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          setCurrentPage((p) => Math.max(1, p - 1));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, numPages, pdfRenderMode, onClose]);

  // Load PDF or text file
  useEffect(() => {
    if (!file) return;
    let cancelled = false;

    async function loadContent() {
      if (!file) return;
      if (file.ext === 'pdf') {
        setLoading(true);
        setErrorMsg(null);
        try {
          const loadingTask = pdfjsLib.getDocument({ url: file.url });
          const pdfDoc = await loadingTask.promise;
          if (cancelled) {
            void pdfDoc.loadingTask.destroy();
            return;
          }
          pdfDocRef.current = pdfDoc;
          setNumPages(pdfDoc.numPages);
          setCurrentPage(1);
        } catch (err) {
          if (!cancelled) {
            setErrorMsg(err instanceof Error ? err.message : 'Unable to render PDF document.');
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else if (file.mimeCategory === 'text' || file.ext === 'csv') {
        setLoading(true);
        setErrorMsg(null);
        try {
          const response = await fetch(file.url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const txt = await response.text();
          if (!cancelled) setTextContent(txt);
        } catch (err) {
          if (!cancelled) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to load file preview.');
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
    }

    loadContent();

    return () => {
      cancelled = true;
      if (pdfDocRef.current) {
        void pdfDocRef.current.loadingTask.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [file]);

  // Render active PDF page to canvas
  useEffect(() => {
    if (!file || file.ext !== 'pdf' || pdfRenderMode !== 'canvas') return;
    const pdfDoc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!pdfDoc || !canvas || numPages === 0) return;

    let renderTask: pdfjsLib.RenderTask | null = null;
    let cancelled = false;

    async function renderPage() {
      if (!pdfDoc || !canvas) return;
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom });
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled && err && (err as { name?: string }).name !== 'RenderingCancelledException') {
          setErrorMsg('Failed to render page.');
        }
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [file, numPages, currentPage, zoom, pdfRenderMode]);

  if (!file) return null;

  const handleCopyUrl = async () => {
    try {
      const absoluteUrl = new URL(file.url, window.location.origin).toString();
      await navigator.clipboard.writeText(absoluteUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const csvRows = file.ext === 'csv' && textContent ? parseCsvRows(textContent) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="viewer-modal-title"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-5xl h-[90vh] bg-white rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Viewer Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-white">
          <div className="min-w-0 flex-1">
            <h2
              id="viewer-modal-title"
              className="text-base sm:text-lg font-semibold text-slate-900 truncate"
            >
              {file.title}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {file.formCode && <span className="font-mono font-medium text-slate-700">{file.formCode}</span>}
              {file.formCode && <span aria-hidden="true">·</span>}
              <span className="uppercase font-mono">{file.ext}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatBytes(file.sizeBytes)}</span>
              <span aria-hidden="true">·</span>
              <span>{file.folderLabel}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {formatShortDate(file.modifiedAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyUrl}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedLink ? 'Copied Link' : 'Copy Link'}</span>
            </button>

            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open Tab</span>
            </a>

            <button
              type="button"
              onClick={() => triggerDirectDownload(file.url, file.filename)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close document preview"
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* PDF Toolbar (only shown for PDF files) */}
        {file.ext === 'pdf' && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
              <button
                type="button"
                onClick={() => setPdfRenderMode('canvas')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  pdfRenderMode === 'canvas'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Built-in Reader
              </button>
              <button
                type="button"
                onClick={() => setPdfRenderMode('native')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  pdfRenderMode === 'native'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Browser Native
              </button>
            </div>

            {pdfRenderMode === 'canvas' && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    aria-label="Previous page"
                    className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-mono tabular-nums text-slate-700 px-2">
                    Page {numPages > 0 ? currentPage : 0} / {numPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage >= numPages}
                    onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                    aria-label="Next page"
                    className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 border-l border-slate-200 pl-4">
                  <button
                    type="button"
                    disabled={zoom <= 0.7}
                    onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.15).toFixed(2))))}
                    aria-label="Zoom out"
                    className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-mono tabular-nums text-slate-700 w-12 text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    disabled={zoom >= 2.0}
                    onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
                    aria-label="Zoom in"
                    className="p-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Viewport Body */}
        <div className="flex-1 overflow-auto bg-slate-800 flex justify-center p-4 sm:p-6">
          {loading && (
            <div className="self-center text-sm text-slate-300 font-medium">
              Loading document preview...
            </div>
          )}

          {errorMsg && (
            <div className="self-center max-w-md bg-white rounded-lg p-6 text-center border border-slate-200">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-900">Inline preview unavailable</p>
              <p className="mt-1 text-xs text-slate-500">{errorMsg}</p>
              <button
                type="button"
                onClick={() => triggerDirectDownload(file.url, file.filename)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download {file.filename}</span>
              </button>
            </div>
          )}

          {!loading && !errorMsg && file.ext === 'pdf' && pdfRenderMode === 'canvas' && (
            <div className="my-auto">
              <canvas
                ref={canvasRef}
                className="bg-white shadow-2xl rounded-xs max-w-full"
              />
            </div>
          )}

          {!loading && !errorMsg && file.ext === 'pdf' && pdfRenderMode === 'native' && (
            <iframe
              src={file.url}
              title={file.title}
              className="w-full h-full bg-white rounded-md border border-slate-700"
            />
          )}

          {!loading && !errorMsg && file.ext === 'csv' && csvRows && (
            <div className="w-full max-w-4xl bg-white rounded-lg border border-slate-200 overflow-auto self-start">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                  <tr>
                    {csvRows[0]?.map((header, i) => (
                      <th key={i} className="px-4 py-2.5 text-xs font-semibold text-slate-700 whitespace-nowrap">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {csvRows.slice(1).map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-slate-50">
                      {row.map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          className="px-4 py-2.5 text-xs text-slate-700 font-mono tabular-nums whitespace-nowrap"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !errorMsg && file.mimeCategory === 'text' && textContent !== null && (
            <div className="w-full max-w-3xl bg-white rounded-lg border border-slate-200 p-6 sm:p-8 self-start">
              <pre className="text-xs sm:text-sm font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                {textContent}
              </pre>
            </div>
          )}

          {!loading && !errorMsg && file.mimeCategory === 'image' && (
            <div className="my-auto flex items-center justify-center">
              <img
                src={file.url}
                alt={file.title}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[72vh] rounded-md shadow-xl bg-white p-2"
              />
            </div>
          )}

          {!loading && !errorMsg && !file.previewable && (
            <div className="self-center max-w-md bg-white rounded-lg p-6 text-center border border-slate-200">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-900">Direct browser preview not supported</p>
              <p className="mt-1.5 text-xs text-slate-500">
                Files with extension <span className="font-mono uppercase">{file.ext}</span> must be downloaded to open locally.
              </p>
              <button
                type="button"
                onClick={() => triggerDirectDownload(file.url, file.filename)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download File ({formatBytes(file.sizeBytes)})</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
