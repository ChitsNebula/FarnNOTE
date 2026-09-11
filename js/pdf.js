/**
 * PDF Engine — FarmNotes PDF Import & Export (File Protocol Compatible)
 * - importPDF: renders each PDF page as a PNG asset into IndexedDB
 * - exportNotebookToPDF: rebuilds PDF with annotations over original background
 * - savePDFToFile: uses File System Access API to overwrite original file
 */

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

window.PDFEngine = {

  // Shared PDF Document Cache to prevent expensive reload & parse churn across on-demand renders
  _docCache: new Map(),

  async getPDFDoc(notebookId, storage) {
    if (!notebookId) return null;
    if (this._docCache.has(notebookId)) {
      try {
        return await this._docCache.get(notebookId);
      } catch (e) {
        this._docCache.delete(notebookId);
      }
    }
    if (!window.pdfjsLib || !storage) return null;
    const docPromise = (async () => {
      const rawPdfBlob = await storage.getAsset(`asset-${notebookId}-raw-pdf`);
      if (!rawPdfBlob) return null;
      const arrayBuffer = await rawPdfBlob.arrayBuffer();
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
      return await loadingTask.promise;
    })();
    this._docCache.set(notebookId, docPromise);
    return await docPromise;
  },

  // ─── IMPORT ───────────────────────────────────────────────────────────────

  async importPDF(file, storage, fileHandle = null, onProgress = null) {
    if (!window.pdfjsLib) throw new Error('PDF.js library failed to load.');

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    const pdfDoc      = await loadingTask.promise;

    const numPages   = pdfDoc.numPages;
    const notebookId = 'pdf-nb-' + Date.now();

    // Cache the parsed pdfDoc immediately for all instant on-demand renders
    this._docCache.set(notebookId, Promise.resolve(pdfDoc));

    const notebook = {
      id:               notebookId,
      title:            file.name.replace(/\.[^/.]+$/, ''),
      coverColor:       '#FF9500',
      coverIcon:        'fa-file-pdf',
      template:         'pdf',
      favorite:         false,
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
      pageCount:        numPages,
      originalFileName: file.name,
      fileHandle:       fileHandle
    };

    // Save notebook metadata first
    await storage.saveNotebook(notebook);

    // Save PDF arrayBuffer in asset storage as master backup for instant page recovery
    try {
      const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });
      await storage.saveAsset(`asset-${notebookId}-raw-pdf`, pdfBlob);
    } catch (e) {}

    // Render Page 1 IMMEDIATELY for instant notebook opening (< 0.5s)!
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');

    const firstPage = await pdfDoc.getPage(1);
    // Base layout viewport at 1.4 for CSS dimensions
    const firstLayoutVp = firstPage.getViewport({ scale: 1.4 });
    const firstW = Math.round(firstLayoutVp.width);
    const firstH = Math.round(firstLayoutVp.height);

    // High-resolution Retina viewport at 2.2 for razor-sharp vector-grade clarity
    const firstRenderVp = firstPage.getViewport({ scale: 2.2 });
    canvas.width  = Math.round(firstRenderVp.width);
    canvas.height = Math.round(firstRenderVp.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await firstPage.render({ canvasContext: ctx, viewport: firstRenderVp }).promise;

    let firstBlob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.96));
    if (!firstBlob) {
      firstBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    }
    await storage.saveAsset(`asset-${notebookId}-page-1`, firstBlob);

    // Create page objects for ALL pages so the notebook structure is ready instantly.
    // Use firstW and firstH so landscape PDFs are recognized as landscape from page 1 to N!
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const assetId = `asset-${notebookId}-page-${pageNum}`;
      const pageObj = {
        id:         `page-${notebookId}-${pageNum}`,
        notebookId,
        index:      pageNum - 1,
        width:      firstW,
        height:     firstH,
        template:   'pdf',
        pdfAssetId: assetId,
        strokes:    [],
        textBoxes:  [],
        images:     []
      };
      await storage.savePage(pageObj);
    }

    if (typeof onProgress === 'function') {
      onProgress(1, numPages);
    }

    // Process remaining pages (2..N) asynchronously in the background
    // so the notebook opens INSTANTLY for the user right now!
    if (numPages > 1) {
      setTimeout(async () => {
        for (let pageNum = 2; pageNum <= numPages; pageNum++) {
          try {
            const assetId = `asset-${notebookId}-page-${pageNum}`;
            const existing = await storage.getAsset(assetId);
            if (existing) continue; // Already rendered on-demand!

            const page     = await pdfDoc.getPage(pageNum);
            const layoutVp = page.getViewport({ scale: 1.4 });
            const pW       = Math.round(layoutVp.width);
            const pH       = Math.round(layoutVp.height);

            const renderVp = page.getViewport({ scale: 2.2 });
            canvas.width  = Math.round(renderVp.width);
            canvas.height = Math.round(renderVp.height);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport: renderVp }).promise;

            let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.96));
            if (!blob) {
              blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            }
            await storage.saveAsset(assetId, blob);

            const pageObj = await storage.getPage(`page-${notebookId}-${pageNum}`);
            if (pageObj) {
              pageObj.width  = pW;
              pageObj.height = pH;
              await storage.savePage(pageObj);
            }

            if (typeof onProgress === 'function') {
              onProgress(pageNum, numPages);
            }
          } catch (err) {
            console.warn(`Background render error page ${pageNum}:`, err);
          }
          await new Promise(r => setTimeout(r, 10));
        }
      }, 50);
    }

    return notebook;
  },

  // ─── SHARED: build flat canvas list (background + annotations) ────────────

  async _buildPageCanvases(pages, canvasEngine, onProgress = null) {
    const results = [];
    const total   = pages.length;

    for (let i = 0; i < total; i++) {
      if (typeof onProgress === 'function') {
        onProgress(i + 1, total, 'กำลังวาดหน้า');
      }

      const pageData = pages[i];
      const w = pageData.width  || 794;
      const h = pageData.height || 1123;

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width  = w;
      exportCanvas.height = h;
      const ctx = exportCanvas.getContext('2d');

      // 1) Draw PDF background or Template lines
      if (pageData.pdfAssetId) {
        try {
          const blob = await window.Storage.getAsset(pageData.pdfAssetId);
          if (blob) {
            const imgUrl = URL.createObjectURL(blob);
            await new Promise((resolve) => {
              const img  = new Image();
              img.onload = () => {
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(imgUrl);
                resolve();
              };
              img.onerror = () => {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                resolve();
              };
              img.src = imgUrl;
            });
          } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
          }
        } catch (e) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        // Plain or template notebook page
        if (canvasEngine && typeof canvasEngine.drawTemplateBackground === 'function') {
          canvasEngine.drawTemplateBackground(ctx, pageData.template || 'grid', w, h);
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
        }
      }

      // 2) Draw image overlays
      if (pageData.images && pageData.images.length) {
        for (const img of pageData.images) {
          if (!img.src) continue;
          await new Promise((resolve) => {
            const el   = new Image();
            el.onload  = () => {
              const imgW = img.w || img.width || 200;
              const imgH = img.h || img.height || 150;
              ctx.drawImage(el, img.x, img.y, imgW, imgH);
              resolve();
            };
            el.onerror = resolve;
            el.src = img.src;
          });
        }
      }

      // 3) Draw strokes
      if (pageData.strokes && pageData.strokes.length && canvasEngine) {
        pageData.strokes.forEach(s => canvasEngine.drawSingleStroke(ctx, s));
      }

      // 4) Draw text boxes
      if (pageData.textBoxes && pageData.textBoxes.length) {
        pageData.textBoxes.forEach(tb => {
          ctx.font      = `${tb.fontSize || 18}px -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
          ctx.fillStyle = tb.color || '#1C1C1E';
          ctx.fillText(tb.text, tb.x, tb.y + (tb.fontSize || 18));
        });
      }

      results.push(exportCanvas);
      await new Promise(r => setTimeout(r, 0));
    }

    return results;
  },

  // ─── EXPORT (download) ────────────────────────────────────────────────────

  async exportNotebookToPDF(notebook, pages, canvasEngine) {
    if (!window.PDFLib) throw new Error('PDFLib library failed to load.');

    const pdfBytes = await this._generatePDFBytes(notebook, pages, canvasEngine);
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
    const link     = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = `${notebook.title || 'FarmNotes_Export'}.pdf`;
    link.click();
  },

  // ─── IMPORT WITH PICKER (Requests File System write permission on open) ───

  async importPDFWithPicker(storage) {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [{
            description: 'PDF Files',
            accept: { 'application/pdf': ['.pdf'] }
          }],
          multiple: false
        });
        const file = await fileHandle.getFile();



        const notebook = await this.importPDF(file, storage, fileHandle);
        return notebook;
      } catch (err) {
        if (err.name === 'AbortError') return null;
        throw err;
      }
    }
    return null;
  },

  // ─── SAVE TO FILE (overwrites original via File System Access API) ─────────

  async savePDFToFile(notebook, pages, canvasEngine, onStatusChange = null) {
    if (!window.PDFLib) throw new Error('PDFLib library failed to load.');

    const filename = (notebook.originalFileName || (notebook.title.endsWith('.pdf') ? notebook.title : notebook.title + '.pdf'));
    let fileHandle = null;

    // 1) Open File Picker IMMEDIATELY within active user gesture (prevents Chrome User Gesture expiration)
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'PDF Files',
            accept: { 'application/pdf': ['.pdf'] }
          }]
        });
      } catch (err) {
        if (err.name === 'AbortError') return { success: false, cancelled: true };
        console.warn('showSaveFilePicker failed or not supported:', err);
      }
    }

    const onProgress = (current, total, label) => {
      if (typeof onStatusChange === 'function') {
        onStatusChange(`${label} ${current}/${total}`);
      }
    };

    // 2) Generate PDF document
    const pdfBytes = await this._generatePDFBytes(notebook, pages, canvasEngine, onProgress);
    const blob     = new Blob([pdfBytes], { type: 'application/pdf' });

    // 3) Save to fileHandle or direct download fallback
    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      notebook.fileHandle = fileHandle;
      await window.Storage.saveNotebook(notebook);

      return { success: true, fileName: fileHandle.name, fileHandle };
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true, fallback: true };
    }
  },

  // ─── INTERNAL: build PDF bytes ────────────────────────────────────────────

  async _generatePDFBytes(notebook, pages, canvasEngine, onProgress = null) {
    const { PDFDocument } = window.PDFLib;
    const pdfDoc          = await PDFDocument.create();

    const canvases = await this._buildPageCanvases(pages, canvasEngine, onProgress);
    const total    = canvases.length;

    for (let i = 0; i < total; i++) {
      if (typeof onProgress === 'function') {
        onProgress(i + 1, total, 'กำลังแปลงหน้า');
      }

      const exportCanvas = canvases[i];
      const pngDataUrl   = exportCanvas.toDataURL('image/png');
      const pngImage     = await pdfDoc.embedPng(pngDataUrl);

      const pdfPage = pdfDoc.addPage([exportCanvas.width, exportCanvas.height]);
      pdfPage.drawImage(pngImage, {
        x: 0, y: 0,
        width:  exportCanvas.width,
        height: exportCanvas.height,
      });

      await new Promise(r => setTimeout(r, 0));
    }

    return await pdfDoc.save();
  }
};
