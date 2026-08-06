/**
 * Scopit - PDF.js Worker Setup
 *
 * Side-effect-only module: points pdfjs-dist at its worker script exactly
 * once. GlobalWorkerOptions.workerSrc must be set before the first
 * getDocument() call anywhere in the app, and no single component is
 * guaranteed to load before another -- e.g. Settings > Company Documents
 * can open FieldMappingModal/SendForSignModal without the main PdfEditorTool
 * (and its PdfCanvas/PageSidebar) ever having mounted. Import this module
 * for its side effect in every file that calls pdfjsLib.getDocument()
 * directly, rather than duplicating the assignment.
 */
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();
