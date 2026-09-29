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
    const unscaledVp = firstPage.getViewport({ scale: 1.0 });
    const isLandscape = unscaledVp.width > unscaledVp.height;

    // Standardize page layout width: ~794px for portrait (A4), ~1066px for landscape (16:9 slides)
    // This prevents gigantic dimensions (e.g. 2688px+) when opening high-res slide PDFs
    const targetLayoutW = isLandscape ? 1066 : 794;
    const baseScale = targetLayoutW / unscaledVp.width;
    const firstLayoutVp = firstPage.getViewport({ scale: baseScale });
    const firstW = Math.round(firstLayoutVp.width);
    const firstH = Math.round(firstLayoutVp.height);

    // High-resolution Retina viewport: use device pixel ratio (min 2) — no arbitrary pixel cap.
    // WebP 0.98 = visually lossless (eliminates DCT ringing artifacts around fine text/lines)
    // while still being 40-60% smaller than PNG, safe for IndexedDB storage.
    const dpr = Math.max(window.devicePixelRatio || 2, 2);
    const renderScale = baseScale * dpr;
    const firstRenderVp = firstPage.getViewport({ scale: renderScale });
    canvas.width  = Math.round(firstRenderVp.width);
    canvas.height = Math.round(firstRenderVp.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await firstPage.render({ canvasContext: ctx, viewport: firstRenderVp }).promise;

    let firstBlob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.98));
    if (!firstBlob) {
      firstBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    }
    await storage.saveAsset(`asset-${notebookId}-page-1`, firstBlob);

    // Save Page 1 slide preview as notebook.coverImage for instant library thumbnail display
    try {
      const thumbScale = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = Math.round(canvas.width * thumbScale);
      thumbCanvas.height = Math.round(canvas.height * thumbScale);
      const tCtx = thumbCanvas.getContext('2d');
      tCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      notebook.coverImage = thumbCanvas.toDataURL('image/jpeg', 0.88);
      await storage.saveNotebook(notebook);
    } catch (err) {
      console.warn('Failed to save cover thumbnail:', err);
    }

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
        pdfPageNum: pageNum,
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
            const pUnscaled = page.getViewport({ scale: 1.0 });
            const pIsLandscape = pUnscaled.width > pUnscaled.height;
            const pTargetW = pIsLandscape ? 1066 : 794;
            const pBaseScale = pTargetW / pUnscaled.width;
            const layoutVp = page.getViewport({ scale: pBaseScale });
            const pW       = Math.round(layoutVp.width);
            const pH       = Math.round(layoutVp.height);

            const pMaxDim = Math.max(pUnscaled.width, pUnscaled.height);
            // DPR-aware scale (min 2) — no arbitrary pixel cap, same logic as page 1
            const pDpr = Math.max(window.devicePixelRatio || 2, 2);
            const pRenderScale = pBaseScale * pDpr;
            const renderVp = page.getViewport({ scale: pRenderScale });
            canvas.width  = Math.round(renderVp.width);
            canvas.height = Math.round(renderVp.height);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport: renderVp }).promise;

            let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.98));
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

      // 3) Draw strokes (including fill bucket strokes)
      if (pageData.strokes && pageData.strokes.length && canvasEngine) {
        for (const s of pageData.strokes) {
          if (s.tool === 'fill' && s.dataUrl && (!s._img || !s._img.complete)) {
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = () => { s._img = img; resolve(); };
              img.onerror = resolve;
              img.src = s.dataUrl;
            });
          }
        }
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
    const storage = window.Storage;

    // ── OVERLAY MODE: for PDF-origin notebooks, load the original vector PDF
    //    and overlay only annotations (strokes/text/images) as transparent PNG.
    //    This preserves vector text in the exported PDF — no rasterization. ──
    if (notebook.template === 'pdf' && storage) {
      let originalPdfDoc = null;
      try {
        const rawBlob = await storage.getAsset(`asset-${notebook.id}-raw-pdf`);
        if (rawBlob) {
          const rawBytes = await rawBlob.arrayBuffer();
          originalPdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
        }
      } catch (e) {
        console.warn('[PDF Export] Could not load raw PDF for overlay mode, falling back:', e);
      }

      if (originalPdfDoc) {
        const outPdfDoc = await PDFDocument.create();
        const total = pages.length;
        for (let i = 0; i < total; i++) {
          if (typeof onProgress === 'function') {
            onProgress(i + 1, total, 'กำลังวาดลายมือทับต้นฉบับ');
          }

          const pageData = pages[i];
          const w = pageData.width  || 794;
          const h = pageData.height || 1123;

          let pdfPageNum = pageData.pdfPageNum;
          if (!pdfPageNum && pageData.pdfAssetId) {
            const m = pageData.pdfAssetId.match(/-page-(\d+)$/);
            if (m) pdfPageNum = parseInt(m[1], 10);
          }

          let pdfPage;
          if (pdfPageNum && pdfPageNum >= 1 && pdfPageNum <= originalPdfDoc.getPageCount()) {
            const [copied] = await outPdfDoc.copyPages(originalPdfDoc, [pdfPageNum - 1]);
            pdfPage = outPdfDoc.addPage(copied);
          } else {
            // Inserted or blank page
            pdfPage = outPdfDoc.addPage([w, h]);
          }

          // Build annotation-only canvas (transparent background)
          const hasAnnotations =
            (pageData.strokes    && pageData.strokes.length)    ||
            (pageData.textBoxes  && pageData.textBoxes.length)  ||
            (pageData.images     && pageData.images.length);

          if (hasAnnotations) {
            const annotCanvas = document.createElement('canvas');
            annotCanvas.width  = w;
            annotCanvas.height = h;
            const ctx = annotCanvas.getContext('2d');

            // 1) Image overlays
            if (pageData.images && pageData.images.length) {
              for (const img of pageData.images) {
                if (!img.src) continue;
                await new Promise((resolve) => {
                  const el = new Image();
                  el.onload  = () => { ctx.drawImage(el, img.x, img.y, img.w || 200, img.h || 150); resolve(); };
                  el.onerror = resolve;
                  el.src = img.src;
                });
              }
            }

            // 2) Strokes
            if (pageData.strokes && pageData.strokes.length && canvasEngine) {
              for (const s of pageData.strokes) {
                if (s.tool === 'fill' && s.dataUrl && (!s._img || !s._img.complete)) {
                  await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => { s._img = img; resolve(); };
                    img.onerror = resolve;
                    img.src = s.dataUrl;
                  });
                }
              }
              pageData.strokes.forEach(s => canvasEngine.drawSingleStroke(ctx, s));
            }

            // 3) Text boxes
            if (pageData.textBoxes && pageData.textBoxes.length) {
              pageData.textBoxes.forEach(tb => {
                ctx.font      = `${tb.fontSize || 18}px -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;
                ctx.fillStyle = tb.color || '#1C1C1E';
                ctx.fillText(tb.text, tb.x, tb.y + (tb.fontSize || 18));
              });
            }

            // Embed annotation PNG into PDF page (scaled to full PDF page size in points)
            const pngDataUrl = annotCanvas.toDataURL('image/png');
            const pngImage   = await outPdfDoc.embedPng(pngDataUrl);
            const { width: pdfW, height: pdfH } = pdfPage.getSize();
            pdfPage.drawImage(pngImage, { x: 0, y: 0, width: pdfW, height: pdfH });
          }

          await new Promise(r => setTimeout(r, 0));
        }

        return await outPdfDoc.save();
      }
    }

    // ── FALLBACK: non-PDF notebooks → classic full-raster approach ──
    const pdfDoc  = await PDFDocument.create();
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
