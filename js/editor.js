/**
 * Editor Controller — Unlimited Multi-Step Undo/Redo Engine (Strokes, Shapes, Images & Text)
 */

window.EditorController = class EditorController {
  constructor(app) {
    this.app = app;
    this.currentNotebook = null;
    this.pages = [];
    this.currentPageIndex = 0;
    this._dirtyPages = new Set();
    this._dbSaveTimer = null;

    this.undoStack = [];
    this.redoStack = [];

    this.titleInput = document.getElementById('doc-title-input');
    this.pageCounterText = document.getElementById('page-counter-text');
    this.zoomLevelText = document.getElementById('zoom-level-text');
    this.saveStatus = document.getElementById('save-status');
    this.toolPopover = document.getElementById('tool-popover');
    this.thumbnailSidebar = document.getElementById('thumbnail-sidebar');
    this.thumbnailList = document.getElementById('thumbnail-list');

    this.toolPopoverTimer = null;

    if (this.toolPopover) {
      ['pointermove', 'pointerdown', 'click', 'mouseover', 'touchstart'].forEach(evt => {
        this.toolPopover.addEventListener(evt, () => this.resetToolPopoverAutoFade());
      });
    }

    window.editorApp = this;
    this.lastLensBlob = null;
    this.bindInstantTap = window.bindInstantTap || function(el, cb) {
      if (el) el.addEventListener('click', cb);
    };

    this.canvasEngine = new window.CanvasEngine('canvas-pages-list', {
      onBeforePageModified: (pageIndex) => this.saveUndoState(pageIndex),
      onPageModified: (pageIndex) => this.handlePageModified(pageIndex),
      onActivePageChanged: (pageIndex) => this.handleActivePageChanged(pageIndex),
      onZoomChanged: (zoom) => {
        this.zoomLevelText.innerText = `${Math.round(zoom * 100)}%`;
      }
    });

    this.initEvents();
  }

  updatePageCounter() {
    if (this.pageCounterText) {
      const current = (this.currentPageIndex !== undefined ? this.currentPageIndex : 0) + 1;
      const total = (this.pages && this.pages.length) ? this.pages.length : 1;
      this.pageCounterText.innerText = `หน้า ${current} / ${total}`;
    }
  }



  async openNotebook(notebookId) {
    this.currentNotebook = await window.Storage.getNotebook(notebookId);
    if (!this.currentNotebook) return;

    this.titleInput.value = this.currentNotebook.title;
    this.pages = await window.Storage.getPagesForNotebook(notebookId);

    // Disable automatic File System Access handle & permission popups on open
    this.activeFileHandle = null;

    if (this.pages.length === 0) {
      const page = {
        id: `page-${notebookId}-1`,
        notebookId,
        index: 0,
        width: 794,
        height: 1123,
        template: this.currentNotebook.template || 'grid',
        strokes: [],
        textBoxes: [],
        images: []
      };
      await window.Storage.savePage(page);
      this.pages = [page];
    }

    let savedPageIndex = 0;
    try {
      const lsVal = localStorage.getItem(`farmnotes_last_page_${notebookId}`);
      if (lsVal !== null) {
        savedPageIndex = parseInt(lsVal, 10);
      } else if (this.currentNotebook.lastPageIndex !== undefined) {
        savedPageIndex = this.currentNotebook.lastPageIndex;
      }
    } catch (e) {}

    const targetPageIndex = (!isNaN(savedPageIndex) && savedPageIndex >= 0 && savedPageIndex < this.pages.length) ? savedPageIndex : 0;
    this.currentPageIndex = targetPageIndex;
    this.pageCounterText.innerText = `หน้า ${targetPageIndex + 1} / ${this.pages.length}`;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();

    await this.canvasEngine.loadPages(this.pages, window.Storage, targetPageIndex);
    this.renderThumbnails();
    this.highlightActiveThumbnail(targetPageIndex);
  }

  handleActivePageChanged(pageIndex) {
    this.currentPageIndex = pageIndex;
    this.pageCounterText.innerText = `หน้า ${pageIndex + 1} / ${this.pages.length}`;
    this.highlightActiveThumbnail(pageIndex);
    if (this.currentNotebook && this.currentNotebook.id) {
      try {
        localStorage.setItem(`farmnotes_last_page_${this.currentNotebook.id}`, pageIndex);
        this.currentNotebook.lastPageIndex = pageIndex;
      } catch (e) {}
    }
  }

  saveUndoState(pageIndex) {
    const idx = pageIndex !== undefined ? pageIndex : this.currentPageIndex;
    const page = this.pages[idx];
    if (!page) return;

    const snapshot = {
      pageIndex: idx,
      strokes: JSON.stringify(page.strokes || []),
      images: JSON.stringify(page.images || []),
      textBoxes: JSON.stringify(page.textBoxes || [])
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.updateUndoRedoButtons();
  }

  handlePageModified(pageIndex) {
    const idx = pageIndex !== undefined ? pageIndex : this.currentPageIndex;
    if (this.pages && this.pages[idx]) {
      this._dirtyPages.add(idx);
    }

    // Silent, fast background save to local IndexedDB (keeps work saved on F5 refresh, 0% lag, 0 popups)
    if (this._dbSaveTimer) {
      clearTimeout(this._dbSaveTimer);
    }
    this._dbSaveTimer = setTimeout(async () => {
      await this.flushPendingSaves();
    }, 150);
  }

  async flushPendingSaves() {
    if (this._dbSaveTimer) {
      clearTimeout(this._dbSaveTimer);
      this._dbSaveTimer = null;
    }

    if (!this.pages || this.pages.length === 0) return;

    // Ensure active page is included if present
    if (this.currentPageIndex !== undefined && this.pages[this.currentPageIndex]) {
      this._dirtyPages.add(this.currentPageIndex);
    }

    const indices = Array.from(this._dirtyPages);
    this._dirtyPages.clear();

    for (const idx of indices) {
      const page = this.pages[idx];
      if (page) {
        try {
          await window.Storage.savePage(page);
        } catch (e) {
          console.warn('Failed to save page to IndexedDB:', idx, e);
        }
      }
    }

    if (this.currentNotebook) {
      try {
        this.currentNotebook.pageCount = this.pages.length;
        this.currentNotebook.lastPageIndex = this.currentPageIndex;
        await window.Storage.saveNotebook(this.currentNotebook);
      } catch (e) {
        console.warn('Failed to update notebook metadata:', e);
      }
    }
  }

  async autoSave() {
    await this.flushPendingSaves();
  }

  updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = this.undoStack.length === 0;
    document.getElementById('btn-redo').disabled = this.redoStack.length === 0;
  }

  undo() {
    if (this.undoStack.length === 0) return;

    const pageIndex = this.currentPageIndex;
    const page = this.pages[pageIndex];
    if (!page) return;

    // Snapshot current state for Redo
    const currentState = {
      pageIndex,
      strokes: JSON.stringify(page.strokes || []),
      images: JSON.stringify(page.images || []),
      textBoxes: JSON.stringify(page.textBoxes || [])
    };
    this.redoStack.push(currentState);

    // Pop last state from Undo stack
    const previousState = this.undoStack.pop();
    const targetPage = this.pages[previousState.pageIndex];
    if (!targetPage) return;

    targetPage.strokes = JSON.parse(previousState.strokes);
    targetPage.images = JSON.parse(previousState.images);
    targetPage.textBoxes = JSON.parse(previousState.textBoxes);

    const view = this.canvasEngine.pageViews[previousState.pageIndex];
    if (view) {
      this.canvasEngine.renderPageStrokes(view);
      this.canvasEngine.renderPageImages(view);
      this.canvasEngine.renderPageTextOverlays(view);
      this.canvasEngine.clearSelection();
    }

    this.updateUndoRedoButtons();
    this.handlePageModified(previousState.pageIndex);
  }

  redo() {
    if (this.redoStack.length === 0) return;

    const pageIndex = this.currentPageIndex;
    const page = this.pages[pageIndex];
    if (!page) return;

    // Snapshot current state for Undo
    const currentState = {
      pageIndex,
      strokes: JSON.stringify(page.strokes || []),
      images: JSON.stringify(page.images || []),
      textBoxes: JSON.stringify(page.textBoxes || [])
    };
    this.undoStack.push(currentState);

    // Pop next state from Redo stack
    const nextState = this.redoStack.pop();
    const targetPage = this.pages[nextState.pageIndex];
    if (!targetPage) return;

    targetPage.strokes = JSON.parse(nextState.strokes);
    targetPage.images = JSON.parse(nextState.images);
    targetPage.textBoxes = JSON.parse(nextState.textBoxes);

    const view = this.canvasEngine.pageViews[nextState.pageIndex];
    if (view) {
      this.canvasEngine.renderPageStrokes(view);
      this.canvasEngine.renderPageImages(view);
      this.canvasEngine.renderPageTextOverlays(view);
      this.canvasEngine.clearSelection();
    }

    this.updateUndoRedoButtons();
    this.handlePageModified(nextState.pageIndex);
  }

  initGoogleLensDrawer() {
    const drawer    = document.getElementById('google-lens-drawer');
    const resizer   = document.getElementById('lens-drawer-resizer');
    const btnClose  = document.getElementById('btn-lens-close');
    const btnExpand = document.getElementById('btn-lens-expand');
    const btnOpen   = document.getElementById('btn-lens-open-tab');

    if (!drawer || !resizer) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      startX = e.clientX;
      startWidth = drawer.offsetWidth;
      resizer.classList.add('is-resizing');
      drawer.style.transition = 'none';
      try { resizer.setPointerCapture(e.pointerId); } catch(err){}
    });

    resizer.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      e.preventDefault();
      const dx = startX - e.clientX;
      const newW = Math.max(320, Math.min(window.innerWidth - 80, startWidth + dx));
      drawer.style.width = `${newW}px`;
    });

    const endResize = (e) => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('is-resizing');
      drawer.style.transition = '';
      try { resizer.releasePointerCapture(e.pointerId); } catch(err){}
    };

    resizer.addEventListener('pointerup', endResize);
    resizer.addEventListener('pointercancel', endResize);

    let isExpanded = false;
    if (btnExpand) {
      btnExpand.addEventListener('click', () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
          drawer.style.width = `${Math.min(880, window.innerWidth - 80)}px`;
          btnExpand.innerHTML = '<i class="fa-solid fa-compress"></i>';
        } else {
          drawer.style.width = '480px';
          btnExpand.innerHTML = '<i class="fa-solid fa-expand"></i>';
        }
      });
    }

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        drawer.classList.add('hidden');
      });
    }

    const launchDirectLens = async () => {
      if (!this.lastLensBlob) return;
      const newTab = window.open('', '_blank');
      if (!newTab) return;

      const previewUrl = URL.createObjectURL(this.lastLensBlob);

      newTab.document.open();
      newTab.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>Google Lens — กำลังส่งรูปภาพ...</title>
  <style>
    body { margin: 0; display: flex; flex-direction: column; align-items: center;
           justify-content: center; min-height: 100vh; font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
           background: #202124; color: #e8eaed; text-align: center; padding: 20px; box-sizing: border-box; }
    .logo { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    .logo .g { color: #4285f4; }
    .logo .o1 { color: #ea4335; }
    .logo .o2 { color: #fbbc05; }
    .logo .g2 { color: #4285f4; }
    .logo .l { color: #34a853; }
    .logo .e { color: #ea4335; }
    p { font-size: 15px; color: #9aa0a6; margin: 8px 0; line-height: 1.5; }
    .spinner { width: 36px; height: 36px; border: 3px solid #3c4043;
               border-top-color: #8ab4f8; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 12px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .preview-img { max-width: 90%; max-height: 220px; border-radius: 8px; border: 1px solid #3c4043; box-shadow: 0 4px 16px rgba(0,0,0,0.5); margin: 12px 0; object-fit: contain; }
    .btn-action { display: inline-block; margin: 8px 6px; padding: 10px 20px; background: #8ab4f8;
                  color: #202124; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; transition: transform 0.15s; }
    .btn-action:hover { transform: scale(1.03); background: #aecbfa; }
    .btn-ocr { background: #34a853; color: #fff; }
    .btn-ocr:hover { background: #46bb66; }
    .tip { font-size: 13px; color: #80868b; margin-top: 10px; }
    .ocr-box { margin-top: 15px; padding: 12px; background: #2d2e30; border-radius: 8px; max-width: 480px; width: 100%; box-sizing: border-box; }
  </style>
</head>
<body>
  <div class="logo">
    <span class="g">G</span><span class="o1">o</span><span class="o2">o</span><span class="g2">g</span><span class="l">l</span><span class="e">e</span> Lens
  </div>
  <div class="spinner" id="sp"></div>
  <p id="msg">กำลังส่งรูปภาพไปยัง Google Lens…</p>
  <img class="preview-img" id="img-preview" src="${previewUrl}" alt="Crop Preview" />
  
  <div id="ocr-area" class="ocr-box" style="display:none;">
    <p style="font-size:13px;color:#bdc1c6;margin-bottom:6px;">ข้อความที่ตรวจพบในภาพ:</p>
    <p id="ocr-text" style="font-size:14px;color:#8ab4f8;font-weight:500;margin-bottom:8px;"></p>
    <a id="btn-ocr" class="btn-action btn-ocr" href="#" target="_blank">🔍 ค้นหาคำตอบของโจทย์นี้บน Google</a>
  </div>

  <div id="action-area" style="display:none;margin-top:10px;">
    <a id="btn-fb" class="btn-action" href="https://images.google.com" target="_blank">🔍 เปิด Google Images (กด Ctrl+V เพื่อค้นหา)</a>
    <p class="tip">💡 หรือคลิกขวาที่รูปภาพด้านบน แล้วเลือก <b>"ค้นหาภาพด้วย Google"</b> ได้ทันที!</p>
  </div>
</body>
</html>`);
      newTab.document.close();

      // Copy to clipboard
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': this.lastLensBlob })]).catch(() => {});
        }
      } catch (e) {}

      // OCR background scan
      if (window.Tesseract) {
        try {
          window.Tesseract.recognize(this.lastLensBlob, 'eng+tha').then(res => {
            if (res && res.data && res.data.text && res.data.text.trim()) {
              const ocrText = res.data.text.trim().replace(/\s+/g, ' ');
              if (ocrText.length > 2) {
                try {
                  const ocrArea = newTab.document.getElementById('ocr-area');
                  const ocrBtn = newTab.document.getElementById('btn-ocr');
                  const ocrTxt = newTab.document.getElementById('ocr-text');
                  if (ocrArea && ocrBtn && ocrTxt) {
                    ocrTxt.innerText = ocrText.length > 90 ? ocrText.substring(0, 90) + '...' : ocrText;
                    ocrBtn.href = `https://www.google.com/search?q=${encodeURIComponent(ocrText)}`;
                    ocrArea.style.display = 'block';
                  }
                } catch (e) {}
              }
            }
          }).catch(() => {});
        } catch (e) {}
      }

      let uploadedUrl = null;

      // Provider 1: sxcu.net (Returns direct raw PNG image URL with CORS)
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 4000);
        const fd = new FormData();
        fd.append('file', this.lastLensBlob, 'crop.png');
        const res = await fetch('https://sxcu.net/api/files/create', {
          method: 'POST',
          body: fd,
          signal: ctrl.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
          const json = await res.json();
          if (json && json.id) {
            uploadedUrl = `https://sxcu.net/${json.id}.png`;
          }
        }
      } catch (e) {}

      if (uploadedUrl) {
        newTab.location.replace(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(uploadedUrl)}`);
      } else {
        try {
          const spEl = newTab.document.getElementById('sp');
          const msgEl = newTab.document.getElementById('msg');
          const actEl = newTab.document.getElementById('action-area');
          if (spEl) spEl.style.display = 'none';
          if (msgEl) msgEl.innerHTML = '📋 ระบบได้คัดลอกรูปภาพลงคลิปบอร์ดเรียบร้อยแล้ว!';
          if (actEl) actEl.style.display = 'block';
        } catch (e) {}
      }
    };

    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        if (this.lastLensUrl) {
          window.open(this.lastLensUrl, '_blank');
        } else if (this.lastLensBlob) {
          launchDirectLens();
        }
      });
    }
  }

  async loadGoogleLensInIframe(blob) {
    const drawer     = document.getElementById('google-lens-drawer');
    const overlay    = document.getElementById('lens-status-overlay');
    const statusText = document.getElementById('lens-status-text');
    const iframeMain = document.getElementById('lens-iframe-main');

    if (!drawer || !iframeMain) return;

    drawer.classList.remove('hidden');
    if (overlay) overlay.classList.remove('hidden');
    if (statusText) statusText.innerText = 'กำลังประมวลผลรูปภาพและค้นหาบน Google...';

    // Hide spinner after 1.5s max
    setTimeout(() => {
      if (overlay) overlay.classList.add('hidden');
    }, 1500);

    // 1. Try OCR text extraction for search query
    let recognizedText = '';
    if (window.Tesseract) {
      try {
        const worker = await window.Tesseract.createWorker('tha+eng');
        const ret = await worker.recognize(blob);
        await worker.terminate();
        if (ret && ret.data && ret.data.text) {
          recognizedText = ret.data.text.trim().replace(/\s+/g, ' ');
        }
      } catch (e) {}
    }

    // Fallback text check from current page text boxes
    if (!recognizedText && this.pages && this.pages[this.currentPageIndex]) {
      const page = this.pages[this.currentPageIndex];
      if (page.textBoxes && page.textBoxes.length) {
        recognizedText = page.textBoxes.map(t => t.text).join(' ');
      }
    }

    // 2. Upload image blob in background for direct Google Lens link
    const formData = new FormData();
    formData.append('file', blob, 'selection.png');

    fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: formData })
      .then(res => res.json())
      .then(json => {
        if (json && json.data && json.data.url) {
          const imgUrl = json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
          this.lastLensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imgUrl)}`;
        }
      }).catch(err => {});

    // 3. Load interactive Google search with igu=1 (Interactive Google UI, 100% iframe allowed!)
    const query = recognizedText || 'UPBEAT 5 Student Book';
    const embedUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&igu=1`;

    iframeMain.src = embedUrl;

    iframeMain.onload = () => {
      if (overlay) overlay.classList.add('hidden');
    };
  }

  initEvents() {
    // Helper: Immediate response on pointerdown for stylus/touch (eliminates jitter-induced click drops)
    const bindInstantTap = window.bindInstantTap || function(el, callback) {
      if (!el || typeof callback !== 'function') return;
      let lastTrigger = 0;
      const execute = (e) => {
        const now = Date.now();
        if (now - lastTrigger < 280) return;
        lastTrigger = now;
        callback(e);
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== undefined) return;
        execute(e);
      });
      el.addEventListener('click', (e) => {
        execute(e);
      });
    };
    this.bindInstantTap = bindInstantTap;

    this.initGoogleLensDrawer();
    this.initCalculator();
    this.initInputModeToggle();

    window.addEventListener('beforeunload', () => {
      const page = this.pages && this.pages[this.currentPageIndex];
      if (page) {
        window.Storage.savePage(page);
      }
      if (this.currentNotebook) {
        this.currentNotebook.lastPageIndex = this.currentPageIndex;
        window.Storage.saveNotebook(this.currentNotebook);
      }
    });

    document.getElementById('btn-back-library').addEventListener('click', async () => {
      if (this.currentNotebook) {
        this.currentNotebook.lastPageIndex = this.currentPageIndex;
        try {
          localStorage.setItem(`farmnotes_last_page_${this.currentNotebook.id}`, this.currentPageIndex);
        } catch (e) {}

        // Guarantee all pending and current page changes are written to IndexedDB
        await this.flushPendingSaves();

        if (this.canvasEngine && this.canvasEngine.pageViews && this.canvasEngine.pageViews[0]) {
          try {
            const v0 = this.canvasEngine.pageViews[0];
            if (v0.canvasReady && v0.bgCanvas) {
              const thumbCanvas = document.createElement('canvas');
              const scale = Math.min(1, 480 / Math.max(v0.width, v0.height));
              thumbCanvas.width = Math.round(v0.width * scale);
              thumbCanvas.height = Math.round(v0.height * scale);
              const tCtx = thumbCanvas.getContext('2d');
              tCtx.fillStyle = '#FFFFFF';
              tCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
              tCtx.drawImage(v0.bgCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
              if (v0.strokeCanvas) {
                tCtx.drawImage(v0.strokeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
              }
              this.currentNotebook.coverImage = thumbCanvas.toDataURL('image/jpeg', 0.88);
            }
          } catch (err) {}
        }
        try {
          await window.Storage.saveNotebook(this.currentNotebook);
        } catch (err) {}
      }
      this.app.showLibrary();
    });

    this.titleInput.addEventListener('change', async () => {
      if (this.currentNotebook) {
        this.currentNotebook.title = this.titleInput.value.trim() || 'ไม่มีชื่อ';
        await window.Storage.saveNotebook(this.currentNotebook);
      }
    });

    bindInstantTap(document.getElementById('btn-undo'), () => this.undo());
    bindInstantTap(document.getElementById('btn-redo'), () => this.redo());

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
      if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (!document.activeElement || (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA' && !document.activeElement.isContentEditable)) {
          e.preventDefault();
          this.activateEyedropper();
        }
      }
    });

    bindInstantTap(document.getElementById('btn-prev-page'), async () => {
      if (this.currentPageIndex > 0) {
        await this.flushPendingSaves();
        this.canvasEngine.scrollToPage(this.currentPageIndex - 1);
      }
    });

    bindInstantTap(document.getElementById('btn-next-page'), async () => {
      if (this.currentPageIndex < this.pages.length - 1) {
        await this.flushPendingSaves();
        this.canvasEngine.scrollToPage(this.currentPageIndex + 1);
      }
    });

    const addPageHandler = async () => {
      this.saveUndoState(this.currentPageIndex);

      const curPage = (this.pages && this.pages.length > 0) ? this.pages[this.currentPageIndex] : null;
      const isLandscape = curPage
        ? (curPage.width > curPage.height)
        : ((this.currentNotebook && this.currentNotebook.orientation === 'landscape') || false);
      const width  = curPage ? curPage.width  : (isLandscape ? 1123 : 794);
      const height = curPage ? curPage.height : (isLandscape ? 794  : 1123);
      const template = curPage ? (curPage.template || this.currentNotebook.template || 'grid') : (this.currentNotebook.template || 'grid');

      // Insert immediately after current page!
      const insertIndex = (this.pages && this.pages.length > 0) ? (this.currentPageIndex + 1) : 0;

      const newPage = {
        id: `page-${this.currentNotebook.id}-${Date.now()}`,
        notebookId: this.currentNotebook.id,
        index: insertIndex,
        width,
        height,
        template,
        strokes: [],
        textBoxes: [],
        images: []
      };

      this.pages.splice(insertIndex, 0, newPage);
      this.pages.forEach((p, idx) => p.index = idx);

      // Persist all shifted pages to IndexedDB
      for (let i = insertIndex; i < this.pages.length; i++) {
        await window.Storage.savePage(this.pages[i]);
      }

      if (this.currentNotebook) {
        this.currentNotebook.pageCount = this.pages.length;
        await window.Storage.saveNotebook(this.currentNotebook);
      }

      await this.canvasEngine.loadPages(this.pages, window.Storage, insertIndex);
      this.renderThumbnails();
      this.updatePageCounter();
      if (typeof this.renderPageOverviewGrid === 'function') {
        this.renderPageOverviewGrid();
      }
      this.handleActivePageChanged(insertIndex);

      if (window.CustomDialog && window.CustomDialog.toast) {
        window.CustomDialog.toast(`แทรกหน้า ${insertIndex + 1} จากทั้งหมด ${this.pages.length} หน้าสำเร็จ`, 1800);
      }

      // No auto-save — user saves manually
      if (this.saveStatus) {
        this.saveStatus.innerHTML = '<i class="fa-solid fa-circle-dot" style="color:#FF9500"></i> ยังไม่ได้บันทึก';
      }
    };

    bindInstantTap(document.getElementById('btn-add-page-top'), addPageHandler);
    bindInstantTap(document.getElementById('btn-add-page-thumb'), addPageHandler);

    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      this.canvasEngine.setZoom(this.canvasEngine.zoom + 0.15);
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      this.canvasEngine.setZoom(this.canvasEngine.zoom - 0.15);
    });

    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      const fitZoom = this.canvasEngine.getSmartFitZoom();
      this.canvasEngine.setZoom(fitZoom);
    });

    // ── Fullscreen Toggle (also works on tablet mode Chromebook without F4 key) ──
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const fullscreenIcon = document.getElementById('fullscreen-icon');

    this.wasFullscreen = false;

    const updateFullscreenIcon = () => {
      const isFs = !!document.fullscreenElement;
      fullscreenIcon.className = isFs ? 'fa-solid fa-compress' : 'fa-solid fa-maximize';
      btnFullscreen.title = isFs ? 'ออกจากเต็มหน้าจอ (F11)' : 'เต็มหน้าจอ (F11)';
      if (isFs) {
        this.wasFullscreen = true;
      }
    };

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.wasFullscreen = true;
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        this.wasFullscreen = false;
        document.exitFullscreen().catch(() => {});
      }
    });

    document.addEventListener('fullscreenchange', updateFullscreenIcon);

    // Auto-restore Fullscreen when user switches back to GoodNotes tab
    const restoreFullscreenOnTabReturn = () => {
      if (this.wasFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          // If browser blocks non-user-gesture fullscreen on tab switch,
          // restore fullscreen on the next tap/click inside the app automatically!
          const restoreOnClick = () => {
            if (this.wasFullscreen && !document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            }
            window.removeEventListener('click', restoreOnClick, true);
            window.removeEventListener('pointerdown', restoreOnClick, true);
          };
          window.addEventListener('click', restoreOnClick, true);
          window.addEventListener('pointerdown', restoreOnClick, true);
        });
      }
    };

    window.addEventListener('focus', restoreFullscreenOnTabReturn);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        restoreFullscreenOnTabReturn();
      }
    });

    // F11 key support as well
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        btnFullscreen.click();
      }
    });

    document.getElementById('btn-export').addEventListener('click', async () => {
      try {
        await window.PDFEngine.exportNotebookToPDF(this.currentNotebook, this.pages, this.canvasEngine);
      } catch (err) {
        console.error('Export error:', err);
      }
    });

    document.getElementById('btn-save-pdf').addEventListener('click', async () => {
      const btn        = document.getElementById('btn-save-pdf');
      const saveStatus = document.getElementById('save-status');

      btn.classList.add('saving');
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';

      try {
        const result = await window.PDFEngine.savePDFToFile(
          this.currentNotebook, this.pages, this.canvasEngine,
          (statusText) => {
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${statusText}`;
          }
        );

        if (result && result.cancelled) {
          btn.classList.remove('saving');
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึก';
          return;
        }

        btn.classList.remove('saving');
        btn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกแล้ว!';
        if (saveStatus) saveStatus.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกลงไฟล์แล้ว';

        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึก';
          if (saveStatus) saveStatus.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกแล้ว';
        }, 3000);

      } catch (err) {
        btn.classList.remove('saving');
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึก';
        alert('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF: ' + err.message);
        console.error('Save PDF error:', err);
      }
    });

    document.querySelectorAll('#main-toolbar .tool-btn[data-tool]').forEach(btn => {
      bindInstantTap(btn, () => {
        const tool = btn.dataset.tool;
        if (!tool) return;

        if (tool === 'image') {
          document.getElementById('image-file-input').click();
          return;
        }

        if (this.canvasEngine) {
          this.canvasEngine.clearSelection();
        }

        document.querySelectorAll('#main-toolbar .tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window.ToolState.currentTool = tool;

        this.updateToolbarSizeDots();
        this.updateToolColorIndicators();
        if (tool !== 'highlighter') {
          this.showToolPopover(tool, btn);
        } else {
          this.toolPopover.classList.add('hidden');
        }
      });
    });

    window.selectTool = (tool) => {
      window.ToolState.currentTool = tool;
      document.querySelectorAll('#main-toolbar .tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      const btn = document.querySelector(`#main-toolbar .tool-btn[data-tool="${tool}"]`);
      if (btn) btn.classList.add('active');
      this.updateToolbarSizeDots();
      this.updateToolColorIndicators();
    };

    document.querySelectorAll('#quick-colors .color-dot').forEach(dot => {
      bindInstantTap(dot, () => {
        const hex = dot.dataset.color;
        const tool = window.ToolState.currentTool;
        if (tool === 'highlighter') {
          window.ToolState.highlighterHex = hex;
          window.ToolState.highlighterColor = window.hexToRgba ? window.hexToRgba(hex, 0.4) : hex;
        } else {
          window.ToolState.color = hex;
        }
        this.updateToolColorIndicators();
      });
    });

    const quickDropperBtn = document.getElementById('btn-quick-eyedropper');
    if (quickDropperBtn) {
      bindInstantTap(quickDropperBtn, () => {
        this.activateEyedropper();
      });
    }

    const nativeColorPicker = document.getElementById('native-color-picker');
    if (nativeColorPicker) {
      nativeColorPicker.addEventListener('input', (e) => {
        const hex = e.target.value;
        const tool = window.ToolState.currentTool;
        if (tool === 'highlighter') {
          window.ToolState.highlighterHex = hex;
          window.ToolState.highlighterColor = window.hexToRgba ? window.hexToRgba(hex, 0.4) : hex;
        } else {
          window.ToolState.color = hex;
        }
        this.updateToolColorIndicators();
      });
    }

    // Color Wheel
    this.initColorWheel();
    this.updateToolColorIndicators();


    document.querySelectorAll('#quick-sizes .size-dot').forEach((dot, dotIdx) => {
      bindInstantTap(dot, () => {
        document.querySelectorAll('#quick-sizes .size-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');

        const tool = window.ToolState.currentTool;
        if (tool === 'highlighter') {
          const sizes = [14, 24, 38];
          window.ToolState.highlighterSize = sizes[dotIdx];
        } else if (tool === 'pencil') {
          const sizes = [1.5, 3, 6];
          window.ToolState.pencilSize = sizes[dotIdx];
        } else if (tool === 'eraser') {
          const sizes = [12, 24, 44];
          window.ToolState.eraserSize = sizes[dotIdx];
        } else {
          const sizes = [2, 4, 8];
          window.ToolState.size = sizes[dotIdx];
        }
      });
    });

    this.updateToolbarSizeDots();

    // ── Draggable Toolbar with Magnetic Snap Zones ───────────────────────────
    this.initToolbarDraggable();

    document.getElementById('btn-toggle-thumbnails').addEventListener('click', () => {
      this.renderPageOverviewGrid();
      document.getElementById('modal-page-overview').classList.remove('hidden');
    });

    document.getElementById('btn-close-overview').addEventListener('click', () => {
      document.getElementById('modal-page-overview').classList.add('hidden');
    });

    document.getElementById('btn-overview-add-page').addEventListener('click', () => {
      addPageHandler();
    });

    const modalOverview = document.getElementById('modal-page-overview');
    modalOverview.addEventListener('click', (e) => {
      if (e.target === modalOverview) {
        modalOverview.classList.add('hidden');
      }
    });


    document.getElementById('image-file-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const dataUrl = evt.target.result;
        if (window.imageCropper) {
          window.imageCropper.open(dataUrl, (croppedUrl) => {
            if (this.canvasEngine) {
              this.saveUndoState(this.currentPageIndex);
              this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, croppedUrl);
            }
          });
        } else if (this.canvasEngine) {
          this.saveUndoState(this.currentPageIndex);
          this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, dataUrl);
        }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });

    // Camera Capture & Direct Insert Initialization
    this.initCameraCapture();
  }

  // ─── CAMERA CAPTURE & DIRECT INSERT SYSTEM ────────────────────────────────────

  initCameraCapture() {
    const btnCamera = document.getElementById('btn-camera-capture');
    const cameraModal = document.getElementById('camera-modal');
    const btnClose = document.getElementById('btn-close-camera');
    const btnShutter = document.getElementById('btn-camera-shutter');
    const btnSwitch = document.getElementById('btn-camera-switch');
    const btnNative = document.getElementById('btn-camera-native');
    const btnFallbackNative = document.getElementById('btn-camera-fallback-native');
    const btnFallbackFile = document.getElementById('btn-camera-fallback-file');
    const fallbackMsg = document.getElementById('camera-fallback-msg');
    const cameraNativeInput = document.getElementById('camera-native-input');
    const videoEl = document.getElementById('camera-video');
    const snapshotCanvas = document.getElementById('camera-snapshot-canvas');

    if (!btnCamera || !cameraModal) return;

    let mediaStream = null;
    let currentFacingMode = 'environment';
    let modalOpenedAt = 0;
    let backdropPointerDown = false;
    let cameraSessionId = 0;

    const stopStream = () => {
      cameraSessionId++; // Invalidate any ongoing stream attempts
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
        mediaStream = null;
      }
      if (videoEl) videoEl.srcObject = null;
    };

    const showFallback = () => {
      stopStream();
      if (videoEl) videoEl.style.display = 'none';
      if (fallbackMsg) fallbackMsg.style.display = 'flex';
      if (btnShutter) btnShutter.style.display = 'none';
      if (btnSwitch) btnSwitch.style.display = 'none';
    };

    const showLiveStream = () => {
      if (videoEl) videoEl.style.display = 'block';
      if (fallbackMsg) fallbackMsg.style.display = 'none';
      if (btnShutter) btnShutter.style.display = 'inline-flex';
      if (btnSwitch) btnSwitch.style.display = 'inline-flex';
    };

    const startCamera = async (facingMode = 'environment') => {
      stopStream();
      const currentSession = cameraSessionId;
      showLiveStream();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.warn('getUserMedia is not supported on this browser/context');
        showFallback();
        return;
      }

      // Progressive Constraints Fallback:
      // 1. Ideal facingMode at 720p (broadly supported across Chromebooks & webcams)
      // 2. Ideal facingMode with no resolution restrictions
      // 3. Any video source available { video: true }
      const attempts = [
        { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode: { ideal: facingMode } }, audio: false },
        { video: true, audio: false }
      ];

      let stream = null;
      let lastErr = null;

      for (const constraints of attempts) {
        if (currentSession !== cameraSessionId || cameraModal.classList.contains('hidden')) {
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (err) {
          lastErr = err;
          console.warn('getUserMedia attempt failed with constraints:', constraints, err);
        }
      }

      // If user closed the modal while camera was loading, terminate the stream immediately
      if (currentSession !== cameraSessionId || cameraModal.classList.contains('hidden')) {
        if (stream) {
          stream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
          });
        }
        return;
      }

      if (stream && videoEl) {
        mediaStream = stream;
        videoEl.srcObject = mediaStream;
        try {
          await videoEl.play();
        } catch (playErr) {
          console.warn('video play warning:', playErr);
        }
      } else {
        console.error('All camera stream attempts failed:', lastErr);
        showFallback();
      }
    };

    const handleCapturedImage = (dataUrl) => {
      stopStream();
      cameraModal.classList.add('hidden');

      if (window.imageCropper) {
        window.imageCropper.open(dataUrl, (croppedUrl) => {
          if (this.canvasEngine) {
            this.saveUndoState(this.currentPageIndex);
            this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, croppedUrl);
            
            if (window.ToolState) window.ToolState.currentTool = 'lasso';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            const lassoBtn = document.querySelector('.tool-btn[data-tool="lasso"]');
            if (lassoBtn) lassoBtn.classList.add('active');

            if (window.showToast) window.showToast('ครอบตัดและแทรกลงในโน้ตแล้ว');
          }
        });
      } else if (this.canvasEngine) {
        this.saveUndoState(this.currentPageIndex);
        this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, dataUrl);
        
        if (window.ToolState) window.ToolState.currentTool = 'lasso';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        const lassoBtn = document.querySelector('.tool-btn[data-tool="lasso"]');
        if (lassoBtn) lassoBtn.classList.add('active');

        if (window.showToast) window.showToast('ถ่ายภาพและแทรกลงในโน้ตแล้ว');
      }
    };

    // Camera Native Input listener (Device Camera App or File intent)
    if (cameraNativeInput) {
      cameraNativeInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
          handleCapturedImage(evt.target.result);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
      });
    }

    if (btnNative) {
      this.bindInstantTap(btnNative, () => {
        if (cameraNativeInput) cameraNativeInput.click();
      });
    }

    if (btnFallbackNative) {
      this.bindInstantTap(btnFallbackNative, () => {
        if (cameraNativeInput) cameraNativeInput.click();
      });
    }

    if (btnFallbackFile) {
      this.bindInstantTap(btnFallbackFile, () => {
        stopStream();
        cameraModal.classList.add('hidden');
        const imgInput = document.getElementById('image-file-input');
        if (imgInput) imgInput.click();
      });
    }

    const openCameraModal = (e) => {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
      }
      modalOpenedAt = Date.now();
      backdropPointerDown = false;
      cameraModal.classList.remove('hidden');
      startCamera(currentFacingMode);
    };

    this.openCameraCapture = openCameraModal;

    this.bindInstantTap(btnCamera, (e) => {
      openCameraModal(e);
    });

    if (btnClose) {
      this.bindInstantTap(btnClose, (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        stopStream();
        cameraModal.classList.add('hidden');
      });
    }

    // Stop click events inside the card from bubbling to backdrop
    const cameraCard = cameraModal.querySelector('.camera-modal-card');
    if (cameraCard) {
      cameraCard.addEventListener('pointerdown', (e) => e.stopPropagation());
      cameraCard.addEventListener('click', (e) => e.stopPropagation());
    }

    cameraModal.addEventListener('pointerdown', (e) => {
      if (e.target === cameraModal) {
        backdropPointerDown = true;
      } else {
        backdropPointerDown = false;
      }
    });

    cameraModal.addEventListener('click', (e) => {
      // 1. Ignore click if modal was opened within 400ms (filters out tap-through / click-bleed)
      if (Date.now() - modalOpenedAt < 400) {
        e.stopPropagation();
        return;
      }
      // 2. Only close if BOTH pointerdown AND click originated on the backdrop
      if (backdropPointerDown && e.target === cameraModal) {
        stopStream();
        cameraModal.classList.add('hidden');
      }
      backdropPointerDown = false;
    });

    if (btnSwitch) {
      this.bindInstantTap(btnSwitch, (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        startCamera(currentFacingMode);
      });
    }

    if (btnShutter) {
      this.bindInstantTap(btnShutter, (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;

        snapshotCanvas.width = videoEl.videoWidth;
        snapshotCanvas.height = videoEl.videoHeight;

        const ctx = snapshotCanvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, snapshotCanvas.width, snapshotCanvas.height);

        const dataUrl = snapshotCanvas.toDataURL('image/png');
        handleCapturedImage(dataUrl);
      });
    }
  }

  // ─── DRAGGABLE TOOLBAR WITH MAGNETIC SNAP ZONES ────────────────────────────

  initToolbarDraggable() {
    const toolbarEl = document.getElementById('main-toolbar');
    const handleBtn = document.getElementById('btn-toggle-toolbar-pos');
    if (!toolbarEl || !handleBtn) return;

    handleBtn.style.touchAction = 'none';

    // Create magnetic snap zone indicator overlay in body if missing
    let indicator = document.getElementById('toolbar-snap-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'toolbar-snap-indicator';
      indicator.className = 'toolbar-snap-indicator';
      const bodyWorkspace = document.querySelector('.editor-body') || document.body;
      bodyWorkspace.appendChild(indicator);
    }

    let isDragging = false;
    let startX = 0, startY = 0;
    let moveDist = 0;
    let targetZone = 'top';
    let activePointerId = null;

    const getClosestZone = (clientX, clientY) => {
      const W = window.innerWidth;
      const H = window.innerHeight;

      // Top Snap Zone: upper 38% of viewport OR top 200px OR central upper half
      if (clientY < 200 || (clientY < H * 0.38 && clientX > W * 0.15 && clientX < W * 0.85)) {
        return 'top';
      }

      // Split remaining lower space into Left vs Right
      if (clientX < W * 0.5) {
        return 'left';
      }
      return 'right';
    };

    const startDrag = (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();

      isDragging = true;
      moveDist = 0;

      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      startX = clientX;
      startY = clientY;
      activePointerId = e.pointerId !== undefined ? e.pointerId : null;

      if (activePointerId !== null) {
        try { handleBtn.setPointerCapture(activePointerId); } catch(err){}
      }
    };

    const onMove = (e) => {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      const dx = clientX - startX;
      const dy = clientY - startY;
      moveDist = Math.hypot(dx, dy);

      if (moveDist >= 5) {
        toolbarEl.classList.add('is-dragging');
        toolbarEl.style.transition = 'none';

        // Center the 54x54px circle EXACTLY under the finger/stylus tip! (27px = radius)
        const parentRect = toolbarEl.parentElement.getBoundingClientRect();
        const currentLeft = clientX - parentRect.left - 27;
        const currentTop  = clientY - parentRect.top - 27;

        toolbarEl.style.left = `${currentLeft}px`;
        toolbarEl.style.top  = `${currentTop}px`;
        toolbarEl.style.right = 'auto';
        toolbarEl.style.transform = 'none';

        // Calculate magnetic snap zone
        targetZone = getClosestZone(clientX, clientY);
        indicator.className = `toolbar-snap-indicator visible snap-${targetZone}`;
      }
    };

    const endDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;

      if (activePointerId !== null) {
        try { handleBtn.releasePointerCapture(activePointerId); } catch(err){}
        activePointerId = null;
      }

      indicator.className = 'toolbar-snap-indicator';

      // Clear inline style overrides immediately so CSS position class takes effect cleanly
      toolbarEl.style.left = '';
      toolbarEl.style.top = '';
      toolbarEl.style.right = '';
      toolbarEl.style.transform = '';
      toolbarEl.style.transition = '';

      toolbarEl.classList.remove('is-dragging');

      if (moveDist < 5) {
        // Simple click without dragging -> cycle positions (top -> right -> left -> top)
        if (toolbarEl.classList.contains('pos-top')) {
          toolbarEl.className = 'editor-toolbar pos-right';
        } else if (toolbarEl.classList.contains('pos-right')) {
          toolbarEl.className = 'editor-toolbar pos-left';
        } else {
          toolbarEl.className = 'editor-toolbar pos-top';
        }
      } else {
        // Dragged -> Apply target snap zone immediately without any jitter!
        toolbarEl.className = `editor-toolbar pos-${targetZone}`;
      }

      if (this.toolPopover) {
        this.toolPopover.classList.add('hidden');
      }
    };

    // Listen to start events on handle button
    handleBtn.addEventListener('pointerdown', startDrag);
    handleBtn.addEventListener('touchstart', startDrag, { passive: false });

    // Listen to move & release events globally on window to prevent Chromebook touch locks
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('touchend', endDrag);
    window.addEventListener('touchcancel', endDrag);

    handleBtn.addEventListener('lostpointercapture', endDrag);
  }

  // ─── COLOR WHEEL PICKER ─────────────────────────────────────────────────────

  initColorWheel() {
    const btn       = document.getElementById('btn-custom-color');
    const popover   = document.getElementById('color-wheel-popover');
    const canvas    = document.getElementById('color-wheel-canvas');
    const preview   = document.getElementById('cw-preview-box');
    const hexInput  = document.getElementById('cw-hex-input');
    const applyBtn  = document.getElementById('cw-apply-btn');
    const brightSl  = document.getElementById('cw-brightness-slider');
    const alphaSl   = document.getElementById('cw-alpha-slider');

    if (!btn || !canvas) return;

    const SIZE    = 200;
    const cx      = SIZE / 2;
    const cy      = SIZE / 2;
    const R       = SIZE / 2 - 2;

    let selectedHue = 0;
    let selectedSat = 100;
    let brightness  = 50;
    let alpha       = 100;

    // ── Helpers ──────────────────────────────────────────────────────────────

    function hslToRgb(h, s, l) {
      s /= 100; l /= 100;
      const k = n => (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)];
    }

    function rgbToHex(r, g, b) {
      return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
    }

    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      return [r,g,b];
    }

    // ── Draw wheel ───────────────────────────────────────────────────────────

    const drawWheel = () => {
      const ctx  = canvas.getContext('2d');
      const L    = Math.max(5, Math.min(95, brightness));
      const imgData = ctx.createImageData(SIZE, SIZE);
      const data    = imgData.data;

      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const dx   = x - cx;
          const dy   = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > R) {
            // Outside circle — transparent
            const idx = (y * SIZE + x) * 4;
            data[idx+3] = 0;
            continue;
          }

          const hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
          const sat = Math.min(100, (dist / R) * 100);
          const [r,g,b] = hslToRgb(hue, sat, L);
          const idx = (y * SIZE + x) * 4;
          data[idx]   = r;
          data[idx+1] = g;
          data[idx+2] = b;
          data[idx+3] = 255;
        }
      }

      ctx.putImageData(imgData, 0, 0);

      // Draw selection indicator
      const rad = (selectedHue * Math.PI) / 180;
      const ix  = cx + Math.cos(rad) * (selectedSat / 100) * R;
      const iy  = cy + Math.sin(rad) * (selectedSat / 100) * R;

      ctx.beginPath();
      ctx.arc(ix, iy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ix, iy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    // ── Update preview & ToolState ────────────────────────────────────────────

    const applyColor = () => {
      const L   = Math.max(5, Math.min(95, brightness));
      const [r,g,b] = hslToRgb(selectedHue, selectedSat, L);
      const hex = rgbToHex(r, g, b);
      const a   = alpha / 100;

      preview.style.background = hex;
      hexInput.value = hex;

      // Update alpha background gradient
      alphaSl.style.background = `linear-gradient(to right, transparent, ${hex}),
        repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 12px 12px`;

      // Apply to ToolState
      const tool = window.ToolState.currentTool;
      if (tool === 'highlighter') {
        window.ToolState.highlighterHex = hex;
        window.ToolState.highlighterColor = window.hexToRgba
          ? window.hexToRgba(hex, a * 0.4)
          : `rgba(${r},${g},${b},${a * 0.4})`;
      } else {
        window.ToolState.color = hex;
      }
      this.updateToolColorIndicators();

      // Update rainbow trigger to show selected hue
      // (keep rainbow but add an orange ring)
    };

    // ── Pick from canvas ─────────────────────────────────────────────────────

    const pickAt = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const px   = (clientX - rect.left) * (SIZE / rect.width);
      const py   = (clientY - rect.top)  * (SIZE / rect.height);
      const dx   = px - cx;
      const dy   = py - cy;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist > R) return;

      selectedHue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      selectedSat = Math.min(100, (dist / R) * 100);

      drawWheel();
      applyColor();
    };

    let dragging = false;
    canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch(err){}
      pickAt(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', e => {
      if (dragging) {
        e.preventDefault();
        pickAt(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}
    });
    canvas.addEventListener('pointercancel', (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}
    });

    // ── Sliders ──────────────────────────────────────────────────────────────

    brightSl.addEventListener('input', () => {
      brightness = parseInt(brightSl.value, 10);
      drawWheel();
      applyColor();
    });

    alphaSl.addEventListener('input', () => {
      alpha = parseInt(alphaSl.value, 10);
      applyColor();
    });

    // ── Hex input ────────────────────────────────────────────────────────────

    applyBtn.addEventListener('click', () => {
      const hex = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const [r,g,b] = hexToRgb(hex);
        // Convert RGB → HSL to update wheel position
        const rn = r/255, gn = g/255, bn = b/255;
        const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn);
        const l   = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch(max) {
            case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
            case gn: h = ((bn - rn) / d + 2) / 6; break;
            case bn: h = ((rn - gn) / d + 4) / 6; break;
          }
        }
        selectedHue = h * 360;
        selectedSat = s * 100;
        brightness  = l * 100;
        brightSl.value = Math.round(brightness);
        drawWheel();
        applyColor();
      }
    });

    // ── Preset dots ──────────────────────────────────────────────────────────

    document.querySelectorAll('.cw-preset-dot').forEach(dot => {
      this.bindInstantTap(dot, () => {
        const hex = dot.dataset.color;
        hexInput.value = hex;
        applyBtn.click();
      });
    });

    const cwDropperBtn = document.getElementById('cw-eyedropper-btn');
    if (cwDropperBtn) {
      this.bindInstantTap(cwDropperBtn, (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        this.activateEyedropper();
      });
    }

    // ── Toggle popover ────────────────────────────────────────────────────────

    this.bindInstantTap(btn, (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      const isHidden = popover.classList.contains('hidden');

      if (isHidden) {
        // Sync color wheel variables to active tool's color when opened
        const isHl = window.ToolState.currentTool === 'highlighter';
        const activeHex = isHl ? (window.ToolState.highlighterHex || '#FFD60A') : (window.ToolState.color || '#1C1C1E');
        hexInput.value = activeHex;
        const [r,g,b] = hexToRgb(activeHex);
        const rn = r/255, gn = g/255, bn = b/255;
        const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn);
        const l   = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch(max) {
            case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
            case gn: h = ((bn - rn) / d + 2) / 6; break;
            case bn: h = ((rn - gn) / d + 4) / 6; break;
          }
        }
        selectedHue = h * 360;
        selectedSat = s * 100;
        brightness  = Math.max(5, Math.min(95, l * 100));

        // Show temporarily to get accurate element dimensions
        popover.classList.remove('hidden');
        drawWheel();
        applyColor();

        const btnRect       = btn.getBoundingClientRect();
        const popoverWidth  = popover.offsetWidth || 256;
        const popoverHeight = popover.offsetHeight || 440;
        const toolbarEl     = document.getElementById('main-toolbar');

        popover.style.top       = '';
        popover.style.bottom    = '';
        popover.style.left      = '';
        popover.style.right     = '';
        popover.style.transform = '';

        if (toolbarEl.classList.contains('pos-right')) {
          // Center vertically with button, clamped strictly within viewport bounds
          let top = (btnRect.top + btnRect.height / 2) - (popoverHeight / 2);
          top = Math.max(12, Math.min(window.innerHeight - popoverHeight - 12, top));
          popover.style.top   = `${top}px`;
          popover.style.right = '76px';
        } else if (toolbarEl.classList.contains('pos-left')) {
          let top = (btnRect.top + btnRect.height / 2) - (popoverHeight / 2);
          top = Math.max(12, Math.min(window.innerHeight - popoverHeight - 12, top));
          popover.style.top  = `${top}px`;
          popover.style.left = '76px';
        } else {
          // pos-top (toolbar floating at top)
          let top = btnRect.bottom + 10;
          if (top + popoverHeight > window.innerHeight - 12) {
            top = btnRect.top - popoverHeight - 10;
          }
          top = Math.max(12, Math.min(window.innerHeight - popoverHeight - 12, top));
          popover.style.top = `${top}px`;

          let left = (btnRect.left + btnRect.width / 2) - (popoverWidth / 2);
          left = Math.max(12, Math.min(window.innerWidth - popoverWidth - 12, left));
          popover.style.left = `${left}px`;
        }

        btn.classList.add('active');
      } else {
        popover.classList.add('hidden');
        btn.classList.remove('active');
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!popover.contains(e.target) && e.target !== btn) {
        popover.classList.add('hidden');
        btn.classList.remove('active');
      }
    });

    // Initial draw (draw wheel without overwriting ToolState.color on page load)
    drawWheel();
  }

  resetToolPopoverAutoFade() {
    if (this.toolPopoverTimer) clearTimeout(this.toolPopoverTimer);

    if (this.toolPopover) {
      this.toolPopover.classList.remove('fading-out');

      if (!this.toolPopover.classList.contains('hidden')) {
        this.toolPopoverTimer = setTimeout(() => {
          this.toolPopover.classList.add('fading-out');
          setTimeout(() => {
            if (this.toolPopover.classList.contains('fading-out')) {
              this.toolPopover.classList.add('hidden');
              this.toolPopover.classList.remove('fading-out');
            }
          }, 350);
        }, 1500);
      }
    }
  }


  updateToolbarSizeDots() {
    const tool = window.ToolState.currentTool;
    const dots = document.querySelectorAll('#quick-sizes .size-dot');
    if (!dots || dots.length < 3) return;

    dots.forEach(d => d.classList.remove('active'));

    if (tool === 'highlighter') {
      const sz = window.ToolState.highlighterSize || 24;
      dots[0].title = 'เส้นบาง (14px)';
      dots[1].title = 'เส้นปานกลาง (24px)';
      dots[2].title = 'เส้นหนา (38px)';
      if (sz <= 18) dots[0].classList.add('active');
      else if (sz <= 30) dots[1].classList.add('active');
      else dots[2].classList.add('active');
    } else if (tool === 'pencil') {
      const sz = window.ToolState.pencilSize || 3;
      dots[0].title = 'เส้นบาง (1.5px)';
      dots[1].title = 'เส้นปานกลาง (3px)';
      dots[2].title = 'เส้นหนา (6px)';
      if (sz <= 2) dots[0].classList.add('active');
      else if (sz <= 4) dots[1].classList.add('active');
      else dots[2].classList.add('active');
    } else if (tool === 'eraser') {
      const sz = window.ToolState.eraserSize || 20;
      dots[0].title = 'ยางลบเล็ก (12px)';
      dots[1].title = 'ยางลบกลาง (24px)';
      dots[2].title = 'ยางลบใหญ่ (44px)';
      if (sz <= 16) dots[0].classList.add('active');
      else if (sz <= 32) dots[1].classList.add('active');
      else dots[2].classList.add('active');
    } else {
      const sz = window.ToolState.size || 4;
      dots[0].title = 'เส้นบาง (2px)';
      dots[1].title = 'เส้นปานกลาง (4px)';
      dots[2].title = 'เส้นหนา (8px)';
      if (sz <= 2) dots[0].classList.add('active');
      else if (sz <= 5) dots[1].classList.add('active');
      else dots[2].classList.add('active');
    }
  }

  updateToolColorIndicators() {
    const penTip = document.querySelector('.pen-color-tip');
    if (penTip) {
      penTip.style.background = window.ToolState.color || '#1C1C1E';
    }

    const hlTip = document.querySelector('.hl-color-tip');
    if (hlTip) {
      hlTip.style.background = window.ToolState.highlighterHex || '#FFD60A';
    }

    const fillTip = document.querySelector('.fill-color-tip');
    if (fillTip) {
      fillTip.style.background = window.ToolState.color || '#1C1C1E';
    }

    const currentTool = window.ToolState.currentTool;
    const activeColor = (currentTool === 'highlighter'
      ? (window.ToolState.highlighterHex || '#FFD60A')
      : (window.ToolState.color || '#1C1C1E')).toLowerCase();

    document.querySelectorAll('#quick-colors .color-dot').forEach(dot => {
      const dotColor = (dot.dataset.color || '').toLowerCase();
      dot.classList.toggle('active', dotColor === activeColor);
    });

    if (this.canvasEngine && typeof this.canvasEngine.updateCursorColor === 'function') {
      this.canvasEngine.updateCursorColor();
    }
  }

  // ─── EYEDROPPER INTEGRATION ──────────────────────────────────────────────────

  async activateEyedropper() {
    const quickBtn = document.getElementById('btn-quick-eyedropper');
    const cwDropperBtn = document.getElementById('cw-eyedropper-btn');

    // Close color wheel popover if open so it doesn't obstruct view
    const cwPopover = document.getElementById('color-wheel-popover');
    if (cwPopover && !cwPopover.classList.contains('hidden')) {
      cwPopover.classList.add('hidden');
      const cwBtn = document.getElementById('btn-custom-color');
      if (cwBtn) cwBtn.classList.remove('active');
    }

    // Try Chromium Native EyeDropper API first if supported
    if (window.EyeDropper) {
      try {
        const dropper = new window.EyeDropper();
        const res = await dropper.open();
        if (res && res.sRGBHex) {
          this.applySampledColor(res.sRGBHex);
          return;
        }
      } catch (err) {
        // If canceled by user (AbortError or Escape), do nothing
        if (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('cancel'))) {
          return;
        }
        // If unexpected error, fall through to canvas eyedropper below
      }
    }

    // In-App Canvas Loupe Eyedropper (iOS / Safari / Firefox / Stylus / Touch)
    if (this.canvasEngine) {
      if (quickBtn) quickBtn.classList.add('active');
      if (cwDropperBtn) cwDropperBtn.classList.add('active');

      if (window.CustomDialog && window.CustomDialog.toast) {
        window.CustomDialog.toast('โหมดดูดสี: แตะหรือลากบนเอกสารเพื่อเลือกสี (กด Esc เพื่อยกเลิก)', 2400);
      }

      this.canvasEngine.startEyedropper(
        (hex) => {
          if (quickBtn) quickBtn.classList.remove('active');
          if (cwDropperBtn) cwDropperBtn.classList.remove('active');
          this.applySampledColor(hex);
        },
        () => {
          if (quickBtn) quickBtn.classList.remove('active');
          if (cwDropperBtn) cwDropperBtn.classList.remove('active');
        }
      );
    }
  }

  applySampledColor(hex) {
    if (!hex) return;
    hex = hex.toUpperCase();

    const tool = window.ToolState.currentTool;
    if (tool === 'highlighter') {
      window.ToolState.highlighterHex = hex;
      window.ToolState.highlighterColor = window.hexToRgba
        ? window.hexToRgba(hex, 0.4)
        : hex;
    } else {
      window.ToolState.color = hex;
      if (tool === 'pencil') {
        window.ToolState.pencilColor = hex;
      }
    }

    this.updateToolColorIndicators();

    // Update Color Wheel Popover elements if open or initialized
    const cwPreview = document.getElementById('cw-preview-box');
    const cwHexInput = document.getElementById('cw-hex-input');
    if (cwPreview) cwPreview.style.background = hex;
    if (cwHexInput) cwHexInput.value = hex;

    // Toast feedback
    if (window.CustomDialog && window.CustomDialog.toast) {
      window.CustomDialog.toast(`ดูดสีสำเร็จ: ${hex}`, 2000);
    }
  }

  // ─── TOOL POPOVER ────────────────────────────────────────────────────────────

  showToolPopover(tool, targetBtn) {
    this.toolPopover.classList.remove('fading-out');

    const toolbarEl = document.getElementById('main-toolbar');
    
    this.toolPopover.style.top = '';
    this.toolPopover.style.bottom = '';
    this.toolPopover.style.left = '';
    this.toolPopover.style.right = '';
    this.toolPopover.style.transform = '';

    if (toolbarEl.classList.contains('pos-top')) {
      this.toolPopover.style.top = '76px';
      this.toolPopover.style.left = '50%';
      this.toolPopover.style.transform = 'translateX(-50%)';
    } else if (toolbarEl.classList.contains('pos-right')) {
      this.toolPopover.style.top = '16px';
      this.toolPopover.style.right = '76px';
    } else {
      this.toolPopover.style.top = '16px';
      this.toolPopover.style.left = '76px';
    }

    if (tool === 'pen') {
      this.toolPopover.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label>ชนิดหัวปากกา (PEN STYLE)</label>
          <div class="option-chips-group">
            <button class="option-chip ${window.ToolState.penStyle === 'fountain' ? 'active' : ''}" data-style="fountain">หมึกซึม</button>
            <button class="option-chip ${window.ToolState.penStyle === 'ballpoint' ? 'active' : ''}" data-style="ballpoint">ลูกลื่น</button>
            <button class="option-chip ${window.ToolState.penStyle === 'brush' ? 'active' : ''}" data-style="brush">พู่กัน</button>
          </div>
        </div>
      `;
      this.toolPopover.classList.remove('hidden');

      this.toolPopover.querySelectorAll('.option-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.toolPopover.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          window.ToolState.penStyle = chip.dataset.style;
          this.resetToolPopoverAutoFade();
        });
      });

    } else if (tool === 'eraser') {
      this.toolPopover.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label>โหมดยางลบ (ERASER MODE)</label>
          <div class="option-chips-group">
            <button class="option-chip ${window.ToolState.eraserMode === 'pixel' ? 'active' : ''}" data-mode="pixel">ลบพิกเซล</button>
            <button class="option-chip ${window.ToolState.eraserMode === 'object' ? 'active' : ''}" data-mode="object">ลบทั้งเส้น</button>
          </div>
        </div>
      `;
      this.toolPopover.classList.remove('hidden');

      this.toolPopover.querySelectorAll('.option-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.toolPopover.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          window.ToolState.eraserMode = chip.dataset.mode;
          this.resetToolPopoverAutoFade();
        });
      });

    } else if (tool === 'shape') {
      this.toolPopover.innerHTML = `
        <div class="form-group" style="margin-bottom:0;">
          <label>โหมดรูปทรง (SHAPE DETECT MODE)</label>
          <div class="option-chips-group" style="flex-wrap: wrap;">
            <button class="option-chip ${window.ToolState.shapeType === 'auto' ? 'active' : ''}" data-shape="auto">⚡ อัตโนมัติ</button>
            <button class="option-chip ${window.ToolState.shapeType === 'line' ? 'active' : ''}" data-shape="line">📏 เส้นตรง</button>
            <button class="option-chip ${window.ToolState.shapeType === 'triangle' ? 'active' : ''}" data-shape="triangle">🔺 สามเหลี่ยม</button>
            <button class="option-chip ${window.ToolState.shapeType === 'rectangle' ? 'active' : ''}" data-shape="rectangle">⬜ สี่เหลี่ยม</button>
            <button class="option-chip ${window.ToolState.shapeType === 'circle' ? 'active' : ''}" data-shape="circle">⚪ วงกลม</button>
          </div>
        </div>
      `;
      this.toolPopover.classList.remove('hidden');

      this.toolPopover.querySelectorAll('.option-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.toolPopover.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          window.ToolState.shapeType = chip.dataset.shape;
          this.resetToolPopoverAutoFade();
        });
      });

    } else {
      this.toolPopover.classList.add('hidden');
    }

    if (!this.toolPopover.classList.contains('hidden')) {
      this.resetToolPopoverAutoFade();
    }
  }



  async renderOverviewCardSnapshot(page, idx, snapshotCanvas, pWidth, pHeight) {
    const sCtx = snapshotCanvas.getContext('2d');

    // 1. Fill white canvas background
    sCtx.fillStyle = '#FFFFFF';
    sCtx.fillRect(0, 0, pWidth, pHeight);

    const view = this.canvasEngine.pageViews ? this.canvasEngine.pageViews[idx] : null;

    // 2. Render from active canvas if in memory
    if (view && view.canvasReady && view.bgCanvas && view.strokeCanvas) {
      try {
        sCtx.drawImage(view.bgCanvas, 0, 0, pWidth, pHeight);
        sCtx.drawImage(view.strokeCanvas, 0, 0, pWidth, pHeight);
        return;
      } catch(err) {}
    }

    // 3. Offscreen / VRAM recycled page: Fetch PDF background asset from IndexedDB
    const storage = window.Storage || this.canvasEngine.storage;
    if (page.pdfAssetId && storage) {
      try {
        let imgUrl = page._cachedPdfUrl;
        if (!imgUrl) {
          const blob = await storage.getAsset(page.pdfAssetId);
          if (blob) {
            imgUrl = URL.createObjectURL(blob);
            page._cachedPdfUrl = imgUrl;
          }
        }
        if (imgUrl) {
          await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              sCtx.drawImage(img, 0, 0, pWidth, pHeight);
              resolve();
            };
            img.onerror = resolve;
            img.src = imgUrl;
          });
        } else {
          if (this.canvasEngine.drawTemplateBackground) {
            this.canvasEngine.drawTemplateBackground(sCtx, page.template || 'grid', pWidth, pHeight);
          }
        }
      } catch(e) {
        if (this.canvasEngine.drawTemplateBackground) {
          this.canvasEngine.drawTemplateBackground(sCtx, page.template || 'grid', pWidth, pHeight);
        }
      }
    } else {
      if (this.canvasEngine.drawTemplateBackground) {
        this.canvasEngine.drawTemplateBackground(sCtx, page.template || 'grid', pWidth, pHeight);
      }
    }

    // 4. Draw strokes on top
    if (page.strokes && this.canvasEngine.drawSingleStroke) {
      page.strokes.forEach(s => this.canvasEngine.drawSingleStroke(sCtx, s));
    }
  }

  renderPageOverviewGrid() {
    const gridEl = document.getElementById('page-overview-grid');
    if (!gridEl) return;

    gridEl.innerHTML = '';

    this.pages.forEach((page, idx) => {
      const card = document.createElement('div');
      card.className = `overview-card-item ${idx === this.currentPageIndex ? 'active' : ''}`;
      card.dataset.pageIndex = idx;
      card.style.cursor = 'pointer';

      // Render Page Snapshot Card Box
      const thumbBox = document.createElement('div');
      thumbBox.className = 'overview-thumb-box';

      const view = this.canvasEngine.pageViews ? this.canvasEngine.pageViews[idx] : null;
      let pWidth = 794;
      let pHeight = 1123;
      if (view && view.width && view.height) {
        pWidth = view.width;
        pHeight = view.height;
      } else if (page && page.width && page.height) {
        pWidth = page.width;
        pHeight = page.height;
      }

      thumbBox.style.aspectRatio = `${pWidth} / ${pHeight}`;

      const snapshotCanvas = document.createElement('canvas');
      snapshotCanvas.width = pWidth;
      snapshotCanvas.height = pHeight;
      snapshotCanvas.className = 'overview-thumb-canvas-img';

      this.renderOverviewCardSnapshot(page, idx, snapshotCanvas, pWidth, pHeight);

      thumbBox.appendChild(snapshotCanvas);

      // Card Meta: Page Number (Left) + Dropdown Button ∨ (Right)
      const meta = document.createElement('div');
      meta.className = 'overview-card-meta';
      meta.innerHTML = `
        <span class="overview-page-num">${idx + 1}</span>
        <button class="btn-page-dropdown" title="เมนูตัวเลือกหน้านี้"><i class="fa-solid fa-chevron-down"></i></button>
      `;

      const dropdownBtn = meta.querySelector('.btn-page-dropdown');
      dropdownBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.togglePageDropdownMenu(card, page, idx, dropdownBtn);
      });
      dropdownBtn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });

      card.appendChild(thumbBox);
      card.appendChild(meta);

      // Attach Click Event Listener to the WHOLE CARD container
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.btn-page-dropdown') || e.target.closest('.page-dropdown-menu')) return;
        const modal = document.getElementById('modal-page-overview');
        if (modal) modal.classList.add('hidden');
        await this.flushPendingSaves();
        if (this.canvasEngine && this.canvasEngine.scrollToPage) {
          this.canvasEngine.scrollToPage(idx);
        }
      });

      gridEl.appendChild(card);
    });
  }

  togglePageDropdownMenu(cardEl, page, pageIndex, dropdownBtn) {
    const existingMenu = document.querySelector('.page-dropdown-menu');
    if (existingMenu) {
      const wasForThisBtn = existingMenu._forBtn === dropdownBtn;
      if (typeof existingMenu._cleanup === 'function') {
        existingMenu._cleanup();
      }
      existingMenu.remove();
      if (wasForThisBtn) return; // Clicked same button -> toggle closed
    }

    const menu = document.createElement('div');
    menu.className = 'page-dropdown-menu';
    menu._forBtn = dropdownBtn;
    menu.innerHTML = `
      <button class="page-dropdown-item" data-action="add"><i class="fa-solid fa-plus" style="color:var(--gn-orange)"></i> แทรกหน้าต่อจากนี้</button>
      <button class="page-dropdown-item" data-action="duplicate"><i class="fa-solid fa-copy"></i> คัดลอกหน้านี้</button>
      <button class="page-dropdown-item danger" data-action="delete"><i class="fa-solid fa-trash-can"></i> ลบหน้านี้</button>
    `;

    const cleanupListeners = () => {
      document.removeEventListener('pointerdown', closeDropdownHandler, true);
      const gridContainer = document.querySelector('.page-overview-grid-container');
      if (gridContainer) gridContainer.removeEventListener('scroll', closeDropdownHandler);
    };
    menu._cleanup = cleanupListeners;

    menu.querySelectorAll('.page-dropdown-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        cleanupListeners();
        menu.remove();

        if (action === 'add') {
          await this.insertPageAfter(pageIndex);
        } else if (action === 'duplicate') {
          await this.duplicatePage(pageIndex);
        } else if (action === 'delete') {
          await this.deletePageAtIndex(pageIndex);
        }
      });
    });

    document.body.appendChild(menu);

    if (dropdownBtn) {
      const rect = dropdownBtn.getBoundingClientRect();
      const menuHeight = menu.offsetHeight || 130;
      const menuWidth = menu.offsetWidth || 175;

      let top;
      if (rect.bottom + menuHeight + 12 > window.innerHeight && rect.top > menuHeight) {
        top = rect.top - menuHeight - 6;
        menu.style.transformOrigin = 'bottom right';
      } else {
        top = rect.bottom + 6;
        menu.style.transformOrigin = 'top right';
      }
      top = Math.max(12, Math.min(top, window.innerHeight - menuHeight - 12));

      let left = rect.right - menuWidth;
      left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12));

      menu.style.position = 'fixed';
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.zIndex = '100050';
    }

    const closeDropdownHandler = (evt) => {
      if (menu.contains(evt.target)) return;
      if (dropdownBtn && dropdownBtn.contains(evt.target)) return;
      cleanupListeners();
      menu.remove();
    };

    // Arm dismiss listener on next event tick so opening tap doesn't immediately dismiss it
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.addEventListener('pointerdown', closeDropdownHandler, true);
        const gridContainer = document.querySelector('.page-overview-grid-container');
        if (gridContainer) gridContainer.addEventListener('scroll', closeDropdownHandler, { passive: true });
      }, 50);
    });
  }

  async insertPageAfter(pageIndex) {
    const curPage = this.pages[pageIndex];
    const isLandscape = curPage ? (curPage.width > curPage.height) : false;
    const width  = isLandscape ? (curPage.width  || 1123) : 794;
    const height = isLandscape ? (curPage.height || 794)  : 1123;

    const newPage = {
      id: `page-${this.currentNotebook.id}-${Date.now()}`,
      notebookId: this.currentNotebook.id,
      index: pageIndex + 1,
      width,
      height,
      template: this.currentNotebook.template || 'grid',
      strokes: [],
      textBoxes: [],
      images: []
    };
    this.pages.splice(pageIndex + 1, 0, newPage);
    this.pages.forEach((p, idx) => p.index = idx);

    for (let i = pageIndex + 1; i < this.pages.length; i++) {
      await window.Storage.savePage(this.pages[i]);
    }

    if (this.currentNotebook) {
      this.currentNotebook.pageCount = this.pages.length;
      await window.Storage.saveNotebook(this.currentNotebook);
    }

    await this.canvasEngine.loadPages(this.pages, window.Storage, pageIndex + 1);
    this.renderThumbnails();
    this.updatePageCounter();
    this.renderPageOverviewGrid();
    this.handleActivePageChanged(pageIndex + 1);
    this.autoSave();
  }

  async duplicatePage(pageIndex) {
    const target = this.pages[pageIndex];
    if (!target) return;

    const clonedPage = JSON.parse(JSON.stringify(target));
    clonedPage.id = `page-${this.currentNotebook.id}-${Date.now()}`;
    clonedPage.index = pageIndex + 1;

    this.pages.splice(pageIndex + 1, 0, clonedPage);
    this.pages.forEach((p, idx) => p.index = idx);

    await window.Storage.savePage(clonedPage);
    for (let i = 0; i < this.pages.length; i++) {
      await window.Storage.savePage(this.pages[i]);
    }

    if (this.currentNotebook) {
      this.currentNotebook.pageCount = this.pages.length;
      await window.Storage.saveNotebook(this.currentNotebook);
    }

    await this.canvasEngine.loadPages(this.pages, window.Storage, pageIndex + 1);
    this.renderThumbnails();
    this.updatePageCounter();
    this.renderPageOverviewGrid();
    this.handleActivePageChanged(pageIndex + 1);
    this.autoSave();

    if (window.CustomDialog && window.CustomDialog.toast) {
      window.CustomDialog.toast(`คัดลอกหน้า ${pageIndex + 1} แล้ว`);
    }
  }

  async deletePageAtIndex(pageIndex) {
    if (this.pages.length <= 1) {
      if (window.CustomDialog && window.CustomDialog.alert) {
        await window.CustomDialog.alert('ไม่สามารถลบได้', 'สมุดโน้ตต้องมีอย่างน้อย 1 หน้า');
      } else {
        alert('สมุดโน้ตต้องมีอย่างน้อย 1 หน้า');
      }
      return;
    }

    let confirmed = false;
    if (window.CustomDialog && window.CustomDialog.confirm) {
      confirmed = await window.CustomDialog.confirm('ยืนยันลบหน้า', `คุณแน่ใจหรือไม่ว่าต้องการลบ หน้า ${pageIndex + 1}?`);
    } else {
      confirmed = confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบ หน้า ${pageIndex + 1}?`);
    }
    if (!confirmed) return;

    const deleted = this.pages.splice(pageIndex, 1)[0];
    if (deleted && deleted.id) {
      await window.Storage.deletePage(deleted.id);
      if (deleted.pdfAssetId) {
        try { await window.Storage.deleteAsset(deleted.pdfAssetId); } catch(e) {}
      }
    }

    this.pages.forEach((p, idx) => p.index = idx);
    for (let i = 0; i < this.pages.length; i++) {
      await window.Storage.savePage(this.pages[i]);
    }

    if (this.currentNotebook) {
      this.currentNotebook.pageCount = this.pages.length;
      await window.Storage.saveNotebook(this.currentNotebook);
    }

    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = Math.max(0, this.pages.length - 1);
    }

    await this.canvasEngine.loadPages(this.pages, window.Storage);
    this.updatePageCounter();
    this.renderPageOverviewGrid();
    this.autoSave();

    if (window.CustomDialog && window.CustomDialog.toast) {
      window.CustomDialog.toast(`ลบหน้า ${pageIndex + 1} เรียบร้อย`);
    }
  }

  renderThumbnails() {
    this.renderPageOverviewGrid();
  }

  highlightActiveThumbnail(pageIndex) {
    // Grid handles active state automatically
  }

  initInputModeToggle() {
    const btnMode = document.getElementById('btn-editor-input-mode');
    const iconMode = document.getElementById('icon-editor-input-mode');
    if (!btnMode || !iconMode) return;

    const updateUI = (isTouch) => {
      if (isTouch) {
        iconMode.className = 'fa-solid fa-hand';
        btnMode.classList.add('active-touch-mode');
        btnMode.title = 'โหมดการเขียน: ใช้นิ้วมือเขียนได้ (Touch Drawing) — คลิกเพื่อสลับเป็นโหมดเฉพาะปากกา';
      } else {
        iconMode.className = 'fa-solid fa-pen-fancy';
        btnMode.classList.remove('active-touch-mode');
        btnMode.title = 'โหมดการเขียน: ปากกา / สไตลัส (Stylus Only) — คลิกเพื่อสลับเป็นโหมดใช้นิ้วมือเขียน';
      }
    };

    // Initial state
    const initialTouch = window.AppSettings ? window.AppSettings.getTouchDrawing() : false;
    updateUI(initialTouch);

    // Click handler
    this.bindInstantTap(btnMode, () => {
      const current = window.AppSettings ? window.AppSettings.getTouchDrawing() : false;
      const next = !current;
      if (window.AppSettings) {
        window.AppSettings.setTouchDrawing(next);
      }
      updateUI(next);
      if (window.CustomDialog && window.CustomDialog.toast) {
        window.CustomDialog.toast(
          next ? '🖐️ เปิดโหมดเขียนด้วยนิ้วมือ (Touch Drawing)' : '✒️ เปิดโหมดเฉพาะปากกาสไตลัส (Stylus Only & Palm Rejection)',
          2200
        );
      }
    });

    // Sync when changed elsewhere (e.g. from Settings Modal)
    window.addEventListener('farmnotes-input-mode-changed', (e) => {
      updateUI(!!e.detail?.touchDrawing);
    });
  }

  initCalculator() {
    const btnCalc = document.getElementById('btn-calculator');
    const calcWidget = document.getElementById('calculator-widget');
    const calcClose = document.getElementById('btn-calc-close');
    const calcCopy = document.getElementById('btn-calc-copy');
    const calcInsert = document.getElementById('btn-calc-insert');
    const dragHandle = document.getElementById('calc-drag-handle');
    const btnDeg = document.getElementById('btn-calc-deg');
    const btnShift = document.getElementById('btn-calc-shift');
    const btnSci = document.getElementById('btn-calc-sci');
    const modeIndicator = document.getElementById('calc-mode-indicator');
    const sciModeBadge = document.getElementById('calc-sci-mode');

    const historyEl = document.getElementById('calc-history');
    const inputEl = document.getElementById('calc-input');

    const btnDock = document.getElementById('btn-calc-dock');
    const editorBody = document.querySelector('.editor-body');
    let isDocked = true; // Default to docked right split screen mode

    if (!btnCalc || !calcWidget) return;

    // Set initial docked state (RIGHT side)
    calcWidget.classList.add('docked-right');
    calcWidget.classList.remove('docked-left');
    if (btnDock) btnDock.classList.add('active');

    this.bindInstantTap(btnCalc, (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      calcWidget.classList.toggle('hidden');
      const isVisible = !calcWidget.classList.contains('hidden');
      btnCalc.classList.toggle('active', isVisible);
      if (editorBody) {
        editorBody.classList.toggle('calc-docked-right', isVisible && isDocked);
      }
    });

    if (calcClose) {
      calcClose.addEventListener('click', () => {
        calcWidget.classList.add('hidden');
        btnCalc.classList.remove('active');
        if (editorBody) editorBody.classList.remove('calc-docked-right');
      });
    }

    if (btnDock) {
      btnDock.addEventListener('click', () => {
        isDocked = !isDocked;
        btnDock.classList.toggle('active', isDocked);
        calcWidget.classList.toggle('docked-right', isDocked);
        if (editorBody) {
          editorBody.classList.toggle('calc-docked-right', isDocked && !calcWidget.classList.contains('hidden'));
        }
        if (!isDocked) {
          calcWidget.style.left = 'auto';
          calcWidget.style.top = '75px';
          calcWidget.style.right = '25px';
        }
      });
    }

    // ── Tab Switching & Unit Converter Logic ─────────────────────
    const tabCalc = document.getElementById('tab-calc');
    const tabConverter = document.getElementById('tab-converter');
    const tabEquation = document.getElementById('tab-equation');
    const calcBodyWrapper = document.getElementById('calc-body-wrapper');
    const sciKeypad = calcWidget.querySelector('.sci-keypad-8');
    const unitConverterPanel = document.getElementById('unit-converter-panel');
    const equationSolverPanel = document.getElementById('equation-solver-panel');

    const unitCategories = {
      length: {
        units: {
          m: { name: 'm (เมตร)', factor: 1 },
          km: { name: 'km (กิโลเมตร)', factor: 1000 },
          cm: { name: 'cm (เซนติเมตร)', factor: 0.01 },
          mm: { name: 'mm (มิลลิเมตร)', factor: 0.001 },
          mile: { name: 'mile (ไมล์)', factor: 1609.344 },
          yard: { name: 'yard (หลา)', factor: 0.9144 },
          ft: { name: 'ft (ฟุต)', factor: 0.3048 },
          in: { name: 'in (นิ้ว)', factor: 0.0254 }
        },
        defaultFrom: 'm', defaultTo: 'km'
      },
      mass: {
        units: {
          kg: { name: 'kg (กิโลกรัม)', factor: 1000 },
          g: { name: 'g (กรัม)', factor: 1 },
          mg: { name: 'mg (มิลลิกรัม)', factor: 0.001 },
          lb: { name: 'lb (ปอนด์)', factor: 453.59237 },
          oz: { name: 'oz (ออนซ์)', factor: 28.34952 },
          ton: { name: 'ton (เมตริกตัน)', factor: 1000000 }
        },
        defaultFrom: 'kg', defaultTo: 'g'
      },
      temp: {
        units: {
          c: { name: '°C (เซลเซียส)' },
          f: { name: '°F (ฟาเรนไฮต์)' },
          k: { name: 'K (เคลวิน)' }
        },
        defaultFrom: 'c', defaultTo: 'f'
      },
      area: {
        units: {
          sqm: { name: 'm² (ตร.ม.)', factor: 1 },
          sqkm: { name: 'km² (ตร.กม.)', factor: 1000000 },
          rai: { name: 'ไร่ (Rai)', factor: 1600 },
          ngan: { name: 'งาน (Ngan)', factor: 400 },
          sqwa: { name: 'ตร.วา (Sq. Wa)', factor: 4 },
          sqft: { name: 'ft² (ตร.ฟุต)', factor: 0.092903 },
          acre: { name: 'acre (เอเคอร์)', factor: 4046.856 }
        },
        defaultFrom: 'rai', defaultTo: 'sqm'
      },
      volume: {
        units: {
          l: { name: 'L (ลิตร)', factor: 1 },
          ml: { name: 'mL (มิลลิลิตร)', factor: 0.001 },
          m3: { name: 'm³ (ลบ.ม.)', factor: 1000 },
          gal: { name: 'gal (แกลลอน)', factor: 3.78541 },
          cup: { name: 'cup (ถ้วยตวง)', factor: 0.24 }
        },
        defaultFrom: 'l', defaultTo: 'ml'
      },
      data: {
        units: {
          b: { name: 'B (ไบต์)', factor: 1 },
          kb: { name: 'KB (กิโลไบต์)', factor: 1024 },
          mb: { name: 'MB (เมกะไบต์)', factor: 1048576 },
          gb: { name: 'GB (กิกะไบต์)', factor: 1073741824 },
          tb: { name: 'TB (เทระไบต์)', factor: 1099511627776 }
        },
        defaultFrom: 'mb', defaultTo: 'gb'
      },
      time: {
        units: {
          sec: { name: 'วินาที (Sec)', factor: 1 },
          min: { name: 'นาที (Min)', factor: 60 },
          hour: { name: 'ชั่วโมง (Hour)', factor: 3600 },
          day: { name: 'วัน (Day)', factor: 86400 }
        },
        defaultFrom: 'hour', defaultTo: 'min'
      }
    };

    const categorySelect = document.getElementById('unit-category-select');
    const fromSelect = document.getElementById('unit-from-select');
    const toSelect = document.getElementById('unit-to-select');
    const fromValInput = document.getElementById('unit-from-val');
    const toValInput = document.getElementById('unit-to-val');
    const btnUnitSwap = document.getElementById('btn-unit-swap');
    const btnUnitCopy = document.getElementById('btn-unit-copy');
    const btnUnitInsert = document.getElementById('btn-unit-insert');

    const populateUnitDropdowns = () => {
      if (!categorySelect || !fromSelect || !toSelect) return;
      const catKey = categorySelect.value || 'length';
      const cat = unitCategories[catKey];
      if (!cat) return;

      fromSelect.innerHTML = '';
      toSelect.innerHTML = '';

      Object.keys(cat.units).forEach(key => {
        const u = cat.units[key];
        fromSelect.add(new Option(u.name, key));
        toSelect.add(new Option(u.name, key));
      });

      fromSelect.value = cat.defaultFrom;
      toSelect.value = cat.defaultTo;
    };

    const runUnitConversion = () => {
      if (!categorySelect || !fromSelect || !toSelect || !fromValInput || !toValInput) return;
      const catKey = categorySelect.value;
      const cat = unitCategories[catKey];
      if (!cat) return;

      const fromKey = fromSelect.value;
      const toKey = toSelect.value;
      const val = parseFloat(fromValInput.value) || 0;

      let res = 0;
      if (catKey === 'temp') {
        if (fromKey === toKey) res = val;
        else if (fromKey === 'c' && toKey === 'f') res = val * 9 / 5 + 32;
        else if (fromKey === 'f' && toKey === 'c') res = (val - 32) * 5 / 9;
        else if (fromKey === 'c' && toKey === 'k') res = val + 273.15;
        else if (fromKey === 'k' && toKey === 'c') res = val - 273.15;
        else if (fromKey === 'f' && toKey === 'k') res = (val - 32) * 5 / 9 + 273.15;
        else if (fromKey === 'k' && toKey === 'f') res = (val - 273.15) * 9 / 5 + 32;
      } else {
        const fromUnit = cat.units[fromKey];
        const toUnit = cat.units[toKey];
        if (fromUnit && toUnit) {
          const baseVal = val * fromUnit.factor;
          res = baseVal / toUnit.factor;
        }
      }

      if (Math.abs(res) < 1e-6 && res !== 0) {
        toValInput.value = res.toExponential(4);
      } else {
        toValInput.value = String(Math.round(res * 1e8) / 1e8);
      }

      const formulaEl = document.getElementById('unit-result-formula');
      if (formulaEl && fromSelect.options[fromSelect.selectedIndex] && toSelect.options[toSelect.selectedIndex]) {
        const fromText = fromSelect.options[fromSelect.selectedIndex].text.split(' ')[0];
        const toText = toSelect.options[toSelect.selectedIndex].text.split(' ')[0];
        formulaEl.innerText = `${val} ${fromText} = ${toValInput.value} ${toText}`;
      }
    };

    // ── Tab Switching (3 Tabs: Calc, Converter, Equation) ───────
    const switchCalcTab = (activeTab) => {
      [tabCalc, tabConverter, tabEquation].forEach(t => t && t.classList.remove('active'));
      if (activeTab) activeTab.classList.add('active');

      if (activeTab === tabCalc) {
        if (calcBodyWrapper) calcBodyWrapper.classList.remove('hidden');
        if (sciKeypad) sciKeypad.classList.remove('hidden');
        if (unitConverterPanel) unitConverterPanel.classList.add('hidden');
        if (equationSolverPanel) equationSolverPanel.classList.add('hidden');
      } else if (activeTab === tabConverter) {
        if (calcBodyWrapper) calcBodyWrapper.classList.add('hidden');
        if (sciKeypad) sciKeypad.classList.add('hidden');
        if (unitConverterPanel) unitConverterPanel.classList.remove('hidden');
        if (equationSolverPanel) equationSolverPanel.classList.add('hidden');
        runUnitConversion();
      } else if (activeTab === tabEquation) {
        if (calcBodyWrapper) calcBodyWrapper.classList.add('hidden');
        if (sciKeypad) sciKeypad.classList.add('hidden');
        if (unitConverterPanel) unitConverterPanel.classList.add('hidden');
        if (equationSolverPanel) equationSolverPanel.classList.remove('hidden');
        if (btnEqSolve) btnEqSolve.click();
      }
    };

    if (tabCalc) tabCalc.addEventListener('click', () => switchCalcTab(tabCalc));
    if (tabConverter) tabConverter.addEventListener('click', () => switchCalcTab(tabConverter));
    if (tabEquation) tabEquation.addEventListener('click', () => switchCalcTab(tabEquation));

    // ── Equation Solver Engine & UI ─────────────────────────────
    const eqSectionSingle = document.getElementById('eq-section-single');
    const eqSectionSys = document.getElementById('eq-section-sys');
    const btnEqTypeSingle = document.getElementById('btn-eq-type-single');
    const btnEqTypeSys = document.getElementById('btn-eq-type-sys');
    const eqInputSingle = document.getElementById('eq-input-single');
    const eqInputSys1 = document.getElementById('eq-input-sys1');
    const eqInputSys2 = document.getElementById('eq-input-sys2');
    const btnEqClearSingle = document.getElementById('btn-eq-clear-single');
    const btnEqSolve = document.getElementById('btn-eq-solve');
    const eqDetectedType = document.getElementById('eq-detected-type');
    const eqHighlightAnswer = document.getElementById('eq-highlight-answer');
    const eqStepsContainer = document.getElementById('eq-steps-container');
    const btnEqCopy = document.getElementById('btn-eq-copy');
    const btnEqInsert = document.getElementById('btn-eq-insert');
    let currentEqSolutionText = '';

    const normalizeMathStr = (str) => {
      if (!str) return '0';
      let s = str.trim();
      s = s.replace(/[\u2010-\u2015\u2212]/g, '-');
      s = s.replace(/×/g, '*');
      s = s.replace(/÷/g, '/');
      s = s.replace(/²/g, '^2').replace(/³/g, '^3');

      // Insert multiplication between number and parenthesis: e.g. 3(x - 2) -> 3*(x - 2)
      s = s.replace(/(\d+)\s*\(/g, '$1*(');

      // Insert multiplication between number and variable/identifier: 2x -> 2*x
      s = s.replace(/(\d+)\s*([a-zA-Z])/g, '$1*$2');

      // Insert multiplication between variable and parenthesis: x(x+1) -> x*(x+1) (except math functions)
      const mathFns = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'cbrt', 'log', 'ln', 'abs', 'Math'];
      s = s.replace(/\b([a-zA-Z]+)\s*\(/g, (m, id) => mathFns.includes(id) ? m : `${id}*(`);

      // Parenthesis followed by number/identifier or parenthesis
      s = s.replace(/\)\s*(\d+|[a-zA-Z])/g, ')*$1');
      s = s.replace(/\)\s*\(/g, ')*(');

      // Variable followed by number
      s = s.replace(/([a-zA-Z])\s*(\d+)/g, '$1*$2');

      // Power operator
      s = s.replace(/\^/g, '**');

      // Functions to Math.*
      s = s.replace(/\bsin\(/g, 'Math.sin(');
      s = s.replace(/\bcos\(/g, 'Math.cos(');
      s = s.replace(/\btan\(/g, 'Math.tan(');
      s = s.replace(/\basin\(/g, 'Math.asin(');
      s = s.replace(/\bacos\(/g, 'Math.acos(');
      s = s.replace(/\batan\(/g, 'Math.atan(');
      s = s.replace(/\bsqrt\(/g, 'Math.sqrt(');
      s = s.replace(/\bcbrt\(/g, 'Math.cbrt(');
      s = s.replace(/\blog\(/g, 'Math.log10(');
      s = s.replace(/\bln\(/g, 'Math.log(');
      s = s.replace(/\babs\(/g, 'Math.abs(');
      s = s.replace(/\bpi\b/gi, 'Math.PI');
      s = s.replace(/π/g, 'Math.PI');
      s = s.replace(/\be\b/g, 'Math.E');

      return s;
    };

    const buildEvaluator = (rawEq, vars = ['x']) => {
      let parts = rawEq.split('=');
      let exprStr = '';
      if (parts.length >= 2) {
        let lhs = normalizeMathStr(parts[0]);
        let rhs = normalizeMathStr(parts.slice(1).join('='));
        exprStr = `(${lhs}) - (${rhs})`;
      } else {
        exprStr = normalizeMathStr(rawEq);
      }

      try {
        const fn = new Function(...vars, 'Math', `try { return (${exprStr}); } catch(e){ return NaN; }`);
        return (...args) => fn(...args, Math);
      } catch (err) {
        return null;
      }
    };

    const solveSingleEquation = (rawInput) => {
      if (!rawInput || !rawInput.trim()) {
        return { success: false, error: 'กรุณากรอกสมการ' };
      }

      const f = buildEvaluator(rawInput, ['x']);
      if (!f) return { success: false, error: 'รูปแบบสมการไม่ถูกต้อง' };

      const roundClean = (n) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e7) / 1e7);

      const c = f(0);
      const f1 = f(1);
      const fm1 = f(-1);

      if (isNaN(c) || isNaN(f1) || isNaN(fm1) || !isFinite(c) || !isFinite(f1) || !isFinite(fm1)) {
        return { success: false, error: 'ไม่สามารถคำนวณสมการนี้ได้' };
      }

      let a = (f1 + fm1 - 2 * c) / 2;
      let b = (f1 - fm1) / 2;

      const f2 = f(2);
      const f3 = f(3);
      const quad2 = 4 * a + 2 * b + c;
      const quad3 = 9 * a + 3 * b + c;

      const isPoly = Math.abs(f2 - quad2) < 1e-4 && Math.abs(f3 - quad3) < 1e-4;

      if (isPoly) {
        a = roundClean(a);
        b = roundClean(b);
        let cClean = roundClean(c);

        if (a === 0) {
          // Linear: bx + c = 0
          if (b === 0) {
            if (cClean === 0) {
              return {
                success: true,
                type: 'สมการเอกลักษณ์ (Identity)',
                shortAnswer: 'มีคำตอบเป็นอนันต์',
                answer: 'สมการเป็นจริงสำหรับทุกจำนวนจริง (Infinite Solutions)',
                steps: [
                  { title: '1. วิเคราะห์สมการ', math: `${rawInput}` },
                  { title: '2. ผลลัพธ์', math: 'ทั้งสองข้างของสมการมีค่าเท่ากันเสมอสำหรับทุกค่า x' }
                ]
              };
            } else {
              return {
                success: true,
                type: 'สมการขัดแย้ง (No Solution)',
                shortAnswer: 'ไม่มีคำตอบ',
                answer: 'สมการไม่มีคำตอบ (No Solution)',
                steps: [
                  { title: '1. วิเคราะห์สมการ', math: `${rawInput}` },
                  { title: '2. ผลลัพธ์', math: `เกิดข้อขัดแย้ง: ${cClean} ≠ 0 ดังนั้นไม่มีค่า x ที่สอดคล้อง` }
                ]
              };
            }
          }

          const root = roundClean(-cClean / b);
          const cSign = cClean >= 0 ? `+ ${cClean}` : `− ${Math.abs(cClean)}`;
          return {
            success: true,
            type: 'สมการเชิงเส้น 1 ตัวแปร',
            shortAnswer: `x = ${root}`,
            answer: `x = ${root}`,
            steps: [
              { title: '1. จัดรูปสมการในรูป ax + b = 0', math: `${b}x ${cSign} = 0` },
              { title: '2. ย้ายข้างพจน์ค่าคงที่', math: `${b}x = ${roundClean(-cClean)}` },
              { title: '3. นำสัมประสิทธิ์ไปหารทั้งสองข้าง', math: `x = (${roundClean(-cClean)}) / (${b})` },
              { title: '4. สรุปคำตอบ', math: `x = ${root}` }
            ]
          };
        } else {
          // Quadratic: ax^2 + bx + c = 0
          const delta = roundClean(b * b - 4 * a * cClean);
          const bSign = b >= 0 ? `+ ${b}` : `− ${Math.abs(b)}`;
          const cSign = cClean >= 0 ? `+ ${cClean}` : `− ${Math.abs(cClean)}`;
          const stdForm = `${a}x² ${bSign}x ${cSign} = 0`;

          if (delta > 0) {
            const sqrtDelta = Math.sqrt(delta);
            const r1 = roundClean((-b + sqrtDelta) / (2 * a));
            const r2 = roundClean((-b - sqrtDelta) / (2 * a));
            return {
              success: true,
              type: 'สมการกำลังสอง (2 รากจริง)',
              shortAnswer: `x = ${r1}, ${r2}`,
              answer: `x₁ = ${r1},  x₂ = ${r2}`,
              steps: [
                { title: '1. จัดรูปสมการมาตรฐาน ax² + bx + c = 0', math: stdForm },
                { title: '2. ระบุสัมประสิทธิ์', math: `a = ${a},  b = ${b},  c = ${cClean}` },
                { title: '3. คำนวณดิสคริมิแนนต์ (Δ = b² − 4ac)', math: `Δ = (${b})² − 4(${a})(${cClean}) = ${delta} > 0` },
                { title: '4. ใช้สูตร x = (−b ± √Δ) / 2a', math: `x = (−(${b}) ± √${delta}) / (2 × ${a})` },
                { title: '5. คำนวณคำตอบทั้งสองค่า', math: `x₁ = ${r1},  x₂ = ${r2}` }
              ]
            };
          } else if (delta === 0) {
            const r = roundClean(-b / (2 * a));
            return {
              success: true,
              type: 'สมการกำลังสอง (รากจริงซ้ำ)',
              shortAnswer: `x = ${r}`,
              answer: `x = ${r} (รากซ้ำ)`,
              steps: [
                { title: '1. จัดรูปสมการมาตรฐาน ax² + bx + c = 0', math: stdForm },
                { title: '2. คำนวณดิสคริมิแนนต์ (Δ = b² − 4ac)', math: `Δ = (${b})² − 4(${a})(${cClean}) = 0` },
                { title: '3. ใช้สูตร x = −b / 2a', math: `x = −(${b}) / (2 × ${a}) = ${r}` }
              ]
            };
          } else {
            const realPart = roundClean(-b / (2 * a));
            const imagPart = roundClean(Math.sqrt(-delta) / (2 * Math.abs(a)));
            const shortAns = `${realPart} ± ${imagPart}i`;
            return {
              success: true,
              type: 'สมการกำลังสอง (รากจำนวนเชิงซ้อน)',
              shortAnswer: `x = ${shortAns}`,
              answer: `x = ${realPart} ± ${imagPart}i`,
              steps: [
                { title: '1. จัดรูปสมการมาตรฐาน ax² + bx + c = 0', math: stdForm },
                { title: '2. คำนวณดิสคริมิแนนต์ (Δ = b² − 4ac)', math: `Δ = (${b})² − 4(${a})(${cClean}) = ${delta} < 0` },
                { title: '3. วิเคราะห์ลักษณะคำตอบ', math: 'Δ < 0 สมการไม่มีคำตอบเป็นจำนวนจริง แต่มีคำตอบเป็นจำนวนเชิงซ้อน' },
                { title: '4. ใช้สูตร x = (−b ± i√|Δ|) / 2a', math: `x = (−(${b}) ± i√${-delta}) / (2 × ${a})` },
                { title: '5. สรุปคำตอบจำนวนเชิงซ้อน', math: `x = ${realPart} ± ${imagPart}i` }
              ]
            };
          }
        }
      }

      // Numerical Search in range [-100, 100]
      const roots = [];
      const stepSize = 0.5;
      let prevX = -100;
      let prevY = f(prevX);

      for (let curX = -99.5; curX <= 100; curX += stepSize) {
        const curY = f(curX);
        if (!isNaN(prevY) && !isNaN(curY)) {
          if (prevY * curY <= 0) {
            let left = prevX, right = curX;
            for (let iter = 0; iter < 40; iter++) {
              const mid = (left + right) / 2;
              const midY = f(mid);
              if (Math.abs(midY) < 1e-9) { left = mid; right = mid; break; }
              if (prevY * midY <= 0) right = mid;
              else left = mid;
            }
            const foundRoot = roundClean((left + right) / 2);
            if (!roots.some(r => Math.abs(r - foundRoot) < 1e-4)) {
              roots.push(foundRoot);
            }
          }
        }
        prevX = curX;
        prevY = curY;
      }

      if (roots.length > 0) {
        return {
          success: true,
          type: 'สมการพหุนาม/ฟังก์ชันทั่วไป (คำนวณเชิงตัวเลข)',
          shortAnswer: `x = ${roots.join(', ')}`,
          answer: `x ≈ ${roots.join(', ')}`,
          steps: [
            { title: '1. จัดรูปสมการในรูป f(x) = 0', math: `f(x) = 0` },
            { title: '2. คำนวณหาค่ารากของสมการด้วยระเบียบวิธีเชิงตัวเลข', math: 'ใช้วิธี Bisection / Newton Refinement ในช่วง [-100, 100]' },
            { title: '3. สรุปคำตอบที่พบ', math: `x ≈ ${roots.join(', ')}` }
          ]
        };
      }

      return {
        success: false,
        error: 'ไม่พบรากของสมการในช่วง [-100, 100] หรือรูปแบบสมการซับซ้อนเกินไป'
      };
    };

    const solveEquationSystem = (raw1, raw2) => {
      if (!raw1 || !raw2) {
        return { success: false, error: 'กรุณากรอกสมการทั้ง 2 สมการ' };
      }

      const getLinearCoeffs = (eqStr) => {
        let parts = eqStr.split('=');
        let exprStr = parts.length >= 2 ? `(${normalizeMathStr(parts[0])}) - (${normalizeMathStr(parts.slice(1).join('='))})` : normalizeMathStr(eqStr);
        try {
          const fn = new Function('x', 'y', 'Math', `try { return (${exprStr}); } catch(e){ return NaN; }`);
          const g = (xVal, yVal) => fn(xVal, yVal, Math);
          const g00 = g(0, 0);
          const a = g(1, 0) - g00;
          const b = g(0, 1) - g00;
          const c = -g00;
          return { a, b, c, valid: !isNaN(a) && !isNaN(b) && !isNaN(c) && isFinite(a) && isFinite(b) && isFinite(c) };
        } catch (e) {
          return { valid: false };
        }
      };

      const eq1 = getLinearCoeffs(raw1);
      const eq2 = getLinearCoeffs(raw2);

      if (!eq1.valid || !eq2.valid) {
        return { success: false, error: 'รูปแบบระบบสมการเชิงเส้นไม่ถูกต้อง (รองรับรูปแบบเชิงเส้น ax + by = c)' };
      }

      const roundClean = (n) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1e7) / 1e7);

      const a1 = roundClean(eq1.a), b1 = roundClean(eq1.b), c1 = roundClean(eq1.c);
      const a2 = roundClean(eq2.a), b2 = roundClean(eq2.b), c2 = roundClean(eq2.c);

      const D = roundClean(a1 * b2 - a2 * b1);
      const Dx = roundClean(c1 * b2 - c2 * b1);
      const Dy = roundClean(a1 * c2 - a2 * c1);

      const std1 = `${a1}x ${b1 >= 0 ? '+ ' + b1 : '− ' + Math.abs(b1)}y = ${c1}`;
      const std2 = `${a2}x ${b2 >= 0 ? '+ ' + b2 : '− ' + Math.abs(b2)}y = ${c2}`;

      if (Math.abs(D) > 1e-9) {
        const x = roundClean(Dx / D);
        const y = roundClean(Dy / D);

        return {
          success: true,
          type: 'ระบบสมการเชิงเส้น 2 ตัวแปร',
          shortAnswer: `x = ${x}, y = ${y}`,
          answer: `x = ${x},  y = ${y}`,
          steps: [
            { title: '1. จัดรูปสมการมาตรฐาน', math: `(1) ${std1}\n(2) ${std2}` },
            { title: '2. คำนวณดีเทอร์มิแนนต์หลัก (D = a₁b₂ − a₂b₁)', math: `D = (${a1})(${b2}) − (${a2})(${b1}) = ${D}` },
            { title: '3. คำนวณ Dx และ Dy', math: `Dx = (${c1})(${b2}) − (${c2})(${b1}) = ${Dx}\nDy = (${a1})(${c2}) − (${a2})(${c1}) = ${Dy}` },
            { title: '4. หาค่าคำตอบ x = Dx / D และ y = Dy / D', math: `x = ${Dx} / ${D} = ${x}\ny = ${Dy} / ${D} = ${y}` }
          ]
        };
      } else {
        if (Math.abs(Dx) < 1e-9 && Math.abs(Dy) < 1e-9) {
          return {
            success: true,
            type: 'ระบบสมการเชิงเส้น 2 ตัวแปร',
            shortAnswer: 'มีคำตอบเป็นอนันต์',
            answer: 'ระบบสมการมีคำตอบเป็นอนันต์ (เส้นตรงทับกัน)',
            steps: [
              { title: '1. สมการทั้งสอง', math: `(1) ${std1}\n(2) ${std2}` },
              { title: '2. ดีเทอร์มิแนนต์', math: `D = 0, Dx = 0, Dy = 0` },
              { title: '3. สรุปผล', math: 'สมการทั้งสองเป็นสมการเดียวกัน จึงมีจุดตัดร่วมกันเป็นอนันต์' }
            ]
          };
        } else {
          return {
            success: true,
            type: 'ระบบสมการเชิงเส้น 2 ตัวแปร',
            shortAnswer: 'ไม่มีคำตอบ',
            answer: 'ระบบสมการไม่มีคำตอบ (เส้นตรงขนานกัน)',
            steps: [
              { title: '1. สมการทั้งสอง', math: `(1) ${std1}\n(2) ${std2}` },
              { title: '2. ดีเทอร์มิแนนต์', math: `D = 0 แต่ Dx หรือ Dy ≠ 0` },
              { title: '3. สรุปผล', math: 'กราฟของสมการทั้งสองเป็นเส้นตรงที่ขนานกัน ไม่ตัดกัน จึงไม่มีคำตอบ' }
            ]
          };
        }
      }
    };

    const renderEquationSolution = (sol) => {
      if (!eqDetectedType || !eqHighlightAnswer || !eqStepsContainer) return;
      if (sol.success) {
        eqDetectedType.innerText = sol.type;
        eqHighlightAnswer.innerText = sol.answer;
        eqStepsContainer.innerHTML = sol.steps.map(s => `
          <div class="eq-step-row">
            <div class="eq-step-title">${s.title}</div>
            <div class="eq-step-math">${s.math.replace(/\n/g, '<br>')}</div>
          </div>
        `).join('');

        currentEqSolutionText = `📐 วิธีแก้สมการ: ${sol.type}\n` +
          `คำตอบ: ${sol.answer}\n\n` +
          sol.steps.map(s => `• ${s.title}:\n  ${s.math}`).join('\n\n');
      } else {
        eqDetectedType.innerText = 'ข้อผิดพลาด';
        eqHighlightAnswer.innerText = sol.error || 'ไม่สามารถแก้สมการได้';
        eqStepsContainer.innerHTML = '';
        currentEqSolutionText = `ข้อผิดพลาด: ${sol.error}`;
      }
    };

    if (btnEqTypeSingle && btnEqTypeSys) {
      btnEqTypeSingle.addEventListener('click', () => {
        btnEqTypeSingle.classList.add('active');
        btnEqTypeSys.classList.remove('active');
        if (eqSectionSingle) eqSectionSingle.classList.remove('hidden');
        if (eqSectionSys) eqSectionSys.classList.add('hidden');
      });

      btnEqTypeSys.addEventListener('click', () => {
        btnEqTypeSys.classList.add('active');
        btnEqTypeSingle.classList.remove('active');
        if (eqSectionSys) eqSectionSys.classList.remove('hidden');
        if (eqSectionSingle) eqSectionSingle.classList.add('hidden');
      });
    }

    if (btnEqClearSingle && eqInputSingle) {
      btnEqClearSingle.addEventListener('click', () => {
        eqInputSingle.value = '';
        eqInputSingle.focus();
      });
    }

    if (btnEqSolve) {
      btnEqSolve.addEventListener('click', () => {
        const isSys = btnEqTypeSys && btnEqTypeSys.classList.contains('active');
        if (isSys) {
          const eq1 = eqInputSys1 ? eqInputSys1.value : '';
          const eq2 = eqInputSys2 ? eqInputSys2.value : '';
          const sol = solveEquationSystem(eq1, eq2);
          renderEquationSolution(sol);
        } else {
          const eq = eqInputSingle ? eqInputSingle.value : '';
          const sol = solveSingleEquation(eq);
          renderEquationSolution(sol);
        }
      });
    }

    // Attach preset chips
    const eqPresetChips = document.querySelectorAll('.eq-chip');
    eqPresetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const eqStr = chip.getAttribute('data-eq');
        if (eqInputSingle) {
          eqInputSingle.value = eqStr;
          if (btnEqTypeSingle) btnEqTypeSingle.click();
          if (btnEqSolve) btnEqSolve.click();
        }
      });
    });

    // Enter key handling in inputs
    [eqInputSingle, eqInputSys1, eqInputSys2].forEach(inp => {
      if (inp) {
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (btnEqSolve) btnEqSolve.click();
          }
        });
      }
    });

    // Copy Solution
    if (btnEqCopy) {
      btnEqCopy.addEventListener('click', () => {
        const text = currentEqSolutionText || (eqHighlightAnswer ? eqHighlightAnswer.innerText : '');
        navigator.clipboard.writeText(text);
        window.showToast ? window.showToast('คัดลอกวิธีทำแล้ว') : null;
      });
    }

    // Insert Solution to Notes
    if (btnEqInsert) {
      btnEqInsert.addEventListener('click', () => {
        const text = currentEqSolutionText || (eqHighlightAnswer ? eqHighlightAnswer.innerText : '');
        const activeView = window.editorApp && window.editorApp.canvasEngine && window.editorApp.canvasEngine.pageViews[window.editorApp.canvasEngine.activePageIndex];
        if (activeView) {
          window.editorApp.canvasEngine.addTextBox(activeView, 100, 100, text);
          window.showToast ? window.showToast('แทรกลงในโน้ตแล้ว') : null;
        }
      });
    }

    if (categorySelect) {
      categorySelect.addEventListener('change', () => {
        populateUnitDropdowns();
        runUnitConversion();
      });
    }

    const catChips = document.querySelectorAll('.unit-cat-chip');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const catKey = chip.getAttribute('data-cat');
        if (categorySelect) {
          categorySelect.value = catKey;
          populateUnitDropdowns();
          runUnitConversion();
        }
      });
    });

    if (fromSelect) fromSelect.addEventListener('change', runUnitConversion);
    if (toSelect) toSelect.addEventListener('change', runUnitConversion);
    if (fromValInput) fromValInput.addEventListener('input', runUnitConversion);

    if (btnUnitSwap) {
      btnUnitSwap.addEventListener('click', () => {
        const tmp = fromSelect.value;
        fromSelect.value = toSelect.value;
        toSelect.value = tmp;
        runUnitConversion();
      });
    }

    if (btnUnitCopy) {
      btnUnitCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(toValInput.value);
        window.showToast ? window.showToast('คัดลอกผลลัพธ์แล้ว') : null;
      });
    }

    if (btnUnitInsert) {
      btnUnitInsert.addEventListener('click', () => {
        const fromText = fromSelect.options[fromSelect.selectedIndex].text.split(' ')[0];
        const toText = toSelect.options[toSelect.selectedIndex].text.split(' ')[0];
        const resultStr = `${fromValInput.value} ${fromText} = ${toValInput.value} ${toText}`;
        const activeView = window.editorApp && window.editorApp.canvasEngine && window.editorApp.canvasEngine.pageViews[window.editorApp.canvasEngine.activePageIndex];
        if (activeView) {
          window.editorApp.canvasEngine.addTextBox(activeView, 100, 100, resultStr);
          window.showToast ? window.showToast('แทรกลงในโน้ตแล้ว') : null;
        }
      });
    }

    populateUnitDropdowns();

    // Draggable floating widget logic
    if (dragHandle) {
      let isDragging = false;
      let startX = 0, startY = 0;
      let initialLeft = 0, initialTop = 0;

      dragHandle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.calc-icon-btn')) return;
        e.preventDefault();

        if (isDocked) {
          isDocked = false;
          calcWidget.classList.remove('docked-right', 'docked-left');
          if (editorBody) editorBody.classList.remove('calc-docked-right', 'calc-docked-left');
          if (btnDock) btnDock.classList.remove('active');
        }

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = calcWidget.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        calcWidget.style.right = 'auto';
        calcWidget.style.left = `${initialLeft}px`;
        calcWidget.style.top = `${initialTop}px`;

        try { dragHandle.setPointerCapture(e.pointerId); } catch(err){}
      });

      dragHandle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const newLeft = Math.max(10, Math.min(window.innerWidth - calcWidget.offsetWidth - 10, initialLeft + dx));
        const newTop = Math.max(50, Math.min(window.innerHeight - calcWidget.offsetHeight - 10, initialTop + dy));

        calcWidget.style.left = `${newLeft}px`;
        calcWidget.style.top = `${newTop}px`;
      });

      const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { dragHandle.releasePointerCapture(e.pointerId); } catch(err){}
      };

      dragHandle.addEventListener('pointerup', endDrag);
      dragHandle.addEventListener('pointercancel', endDrag);
    }

    // Calculator State
    let expr = '0';
    let lastAns = 0;
    let isDegMode = true; // DEG (true) vs RAD (false)
    let isShiftActive = false;
    let isSciMode = false;
    let isEvaluated = false;

    const formatSci = (valStr) => {
      let num = typeof valStr === 'number' ? valStr : parseFloat(valStr);
      if (isNaN(num) || !isFinite(num)) return String(valStr);
      if (num === 0) return '0';

      const expStr = num.toExponential();
      const parts = expStr.split('e');
      let coeff = parseFloat(parts[0]);
      coeff = Math.round(coeff * 1e8) / 1e8;
      let exp = parseInt(parts[1], 10);
      if (exp === 0) return String(coeff);
      return `${coeff}×10^(${exp})`;
    };

    // Mode Toggles
    if (btnDeg) {
      btnDeg.addEventListener('click', () => {
        isDegMode = !isDegMode;
        btnDeg.innerText = isDegMode ? 'DEG' : 'RAD';
        if (modeIndicator) modeIndicator.innerText = isDegMode ? 'DEG' : 'RAD';
      });
    }

    if (btnShift) {
      btnShift.addEventListener('click', () => {
        isShiftActive = !isShiftActive;
        btnShift.classList.toggle('active', isShiftActive);
        
        // Update Sci Button labels
        calcWidget.querySelectorAll('.btn-sci[data-shift-fn]').forEach(btn => {
          const fn = btn.dataset.fn;
          const shiftFn = btn.getAttribute('data-shift-fn') || btn.dataset.shiftFn;
          if (isShiftActive) {
            if (shiftFn === 'asin') btn.innerHTML = 'sin<sup>-1</sup>';
            else if (shiftFn === 'acos') btn.innerHTML = 'cos<sup>-1</sup>';
            else if (shiftFn === 'atan') btn.innerHTML = 'tan<sup>-1</sup>';
            else if (shiftFn === 'tenx') btn.innerHTML = '10<sup>x</sup>';
            else if (shiftFn === 'expx') btn.innerHTML = 'e<sup>x</sup>';
            else if (shiftFn === 'cbrt') btn.innerHTML = '∛';
            else if (shiftFn === 'yroot') btn.innerHTML = '<sup>y</sup>√x';
            else if (shiftFn === 'cube') btn.innerHTML = 'x<sup>3</sup>';
          } else {
            if (fn === 'sin') btn.innerHTML = 'sin';
            else if (fn === 'cos') btn.innerHTML = 'cos';
            else if (fn === 'tan') btn.innerHTML = 'tan';
            else if (fn === 'log') btn.innerHTML = 'log';
            else if (fn === 'ln') btn.innerHTML = 'ln';
            else if (fn === 'sqrt') btn.innerHTML = '√';
            else if (fn === 'sqr') btn.innerHTML = 'x<sup>2</sup>';
          }
        });
      });
    }

    const formatExprForDisplay = (str) => {
      if (!str) return '0';
      let html = String(str);

      // Convert yroot e.g. "4 yroot 16" -> "<sup>4</sup>√<span class="calc-root-body">16</span>"
      html = html.replace(/(\d+|\([^\)]+\)|ANS)\s*yroot\s*(\d+(\.\d+)?|\([^\)]+\))/g, (match, p1, p2) => {
        let clean1 = p1.startsWith('(') && p1.endsWith(')') ? p1.slice(1, -1) : p1;
        return `<span class="calc-root-wrap"><sup>${clean1}</sup><span class="calc-root-sym">√</span><span class="calc-root-body">${p2}</span></span>`;
      });
      html = html.replace(/(\d+|\([^\)]+\)|ANS)\s*yroot\s*/g, (match, p1) => {
        let clean1 = p1.startsWith('(') && p1.endsWith(')') ? p1.slice(1, -1) : p1;
        return `<sup>${clean1}</sup>√`;
      });
      html = html.replace(/\byroot\s*(\d+(\.\d+)?|\([^\)]+\))/g, (match, p1) => {
        return `<span class="calc-root-wrap"><sup>y</sup><span class="calc-root-sym">√</span><span class="calc-root-body">${p1}</span></span>`;
      });
      html = html.replace(/\byroot\s*/g, '<sup>y</sup>√');

      // Convert ^(expr) or ^digits or ^symbol to <sup>expr</sup>
      html = html.replace(/\^(\([^\)]+\)|-?\d+(\.\d+)?|[a-zA-Z]+)/g, (match, p1) => {
        let clean = p1.startsWith('(') && p1.endsWith(')') ? p1.slice(1, -1) : p1;
        return `<sup>${clean}</sup>`;
      });

      html = html.replace(/\basin\(/g, 'sin<sup>-1</sup>(');
      html = html.replace(/\bacos\(/g, 'cos<sup>-1</sup>(');
      html = html.replace(/\batan\(/g, 'tan<sup>-1</sup>(');

      // Format sqrt with continuous overline bar
      html = html.replace(/\bsqrt\(([^)]*)\)?/g, (match, p1) => {
        if (!p1) return '√';
        const hasSup = p1.includes('<sup>');
        const bodyCls = hasSup ? 'calc-root-body has-exp' : 'calc-root-body';
        return `<span class="calc-root-wrap"><span class="calc-root-sym">√</span><span class="${bodyCls}">${p1}</span></span>`;
      });
      html = html.replace(/\bsqrt\(/g, '√');

      // Format cbrt with continuous overline bar
      html = html.replace(/\bcbrt\(([^)]*)\)?/g, (match, p1) => {
        if (!p1) return '∛';
        const hasSup = p1.includes('<sup>');
        const bodyCls = hasSup ? 'calc-root-body has-exp' : 'calc-root-body';
        return `<span class="calc-root-wrap"><span class="calc-root-sym">∛</span><span class="${bodyCls}">${p1}</span></span>`;
      });
      html = html.replace(/\bcbrt\(/g, '∛');

      return html;
    };

    const updateDisplay = (historyText = '') => {
      inputEl.innerHTML = formatExprForDisplay(expr);
      historyEl.innerHTML = formatExprForDisplay(historyText);
    };

    const evaluateExpression = () => {
      if (!expr) return '0';
      let s = expr.trim();

      // 1. Remove trailing operators if present e.g. "5 + " -> "5"
      s = s.replace(/[\+\−\-\×\*\÷\/\^]+$/, '').trim();
      if (!s) return '0';

      // 2. Auto-close any unclosed parentheses e.g. "sin(5" -> "sin(5)"
      const openCount = (s.match(/\(/g) || []).length;
      const closeCount = (s.match(/\)/g) || []).length;
      if (openCount > closeCount) {
        s += ')'.repeat(openCount - closeCount);
      }

      // 3. Replace yroot e.g. "4 yroot 16" -> "Math.pow(16, 1/4)"
      s = s.replace(/(\d+(\.\d+)?|\([^\)]+\))\s*yroot\s*(\d+(\.\d+)?|\([^\)]+\))/g, (m, y, yDec, x) => {
        return `Math.pow(${x}, 1/(${y}))`;
      });
      s = s.replace(/\byroot\s*(\d+(\.\d+)?|\([^\)]+\))/g, (m, x) => {
        return `Math.sqrt(${x})`;
      });

      s = s.replace(/\bANS\b/g, `(${lastAns})`);
      s = s.replace(/π/g, 'Math.PI');
      s = s.replace(/\be\b/g, 'Math.E');
      s = s.replace(/×/g, '*');
      s = s.replace(/÷/g, '/');
      s = s.replace(/−/g, '-');
      s = s.replace(/%/g, '/100');
      s = s.replace(/\^/g, '**');

      // Factorial replacement e.g. 5! or (3+2)!
      s = s.replace(/(\d+(\.\d+)?|\([^\)]+\))!/g, (match, p1) => `_fact(${p1})`);

      // Trig & inverse trig replacement
      if (isDegMode) {
        s = s.replace(/\bsin\(/g, '_sinDeg(');
        s = s.replace(/\bcos\(/g, '_cosDeg(');
        s = s.replace(/\btan\(/g, '_tanDeg(');
        s = s.replace(/\basin\(/g, '_asinDeg(');
        s = s.replace(/\bacos\(/g, '_acosDeg(');
        s = s.replace(/\batan\(/g, '_atanDeg(');
      } else {
        s = s.replace(/\bsin\(/g, 'Math.sin(');
        s = s.replace(/\bcos\(/g, 'Math.cos(');
        s = s.replace(/\btan\(/g, 'Math.tan(');
        s = s.replace(/\basin\(/g, 'Math.asin(');
        s = s.replace(/\bacos\(/g, 'Math.acos(');
        s = s.replace(/\batan\(/g, 'Math.atan(');
      }

      s = s.replace(/\blog\(/g, 'Math.log10(');
      s = s.replace(/\bln\(/g, 'Math.log(');
      s = s.replace(/\bsqrt\(/g, 'Math.sqrt(');
      s = s.replace(/\bcbrt\(/g, 'Math.cbrt(');

      const _fact = (n) => {
        let num = Math.floor(parseFloat(n));
        if (num < 0) return NaN;
        if (num === 0 || num === 1) return 1;
        let r = 1;
        for (let i = 2; i <= num; i++) r *= i;
        return r;
      };
      const _toRad = (deg) => deg * Math.PI / 180;
      const _toDeg = (rad) => rad * 180 / Math.PI;

      const _sinDeg = (x) => Math.sin(_toRad(x));
      const _cosDeg = (x) => Math.cos(_toRad(x));
      const _tanDeg = (x) => Math.tan(_toRad(x));
      const _asinDeg = (x) => _toDeg(Math.asin(x));
      const _acosDeg = (x) => _toDeg(Math.acos(x));
      const _atanDeg = (x) => _toDeg(Math.atan(x));

      try {
        const fn = new Function('_fact', '_sinDeg', '_cosDeg', '_tanDeg', '_asinDeg', '_acosDeg', '_atanDeg', `return ${s};`);
        let res = fn(_fact, _sinDeg, _cosDeg, _tanDeg, _asinDeg, _acosDeg, _atanDeg);
        if (typeof res === 'number') {
          if (isNaN(res) || !isFinite(res)) return 'Error';
          return Math.round(res * 1e10) / 1e10;
        }
        return res;
      } catch (err) {
        return 'Error';
      }
    };

    const handleCalcInput = (btn) => {
      const val = btn.dataset.val;
      const insert = btn.dataset.insert;
      const fn = btn.dataset.fn;
      const shiftFn = btn.dataset.shiftFn || btn.getAttribute('data-shift-fn');
      const action = btn.dataset.action;

      if (isEvaluated && (val || insert || fn)) {
        if (val || insert) expr = '0';
        isEvaluated = false;
      }

      if (val !== undefined) {
        if (expr === '0') expr = val === '.' ? '0.' : val;
        else expr += val;
        updateDisplay();
      } else if (insert !== undefined) {
        if (expr === '0' && insert !== '(') expr = insert;
        else expr += insert;
        updateDisplay();
      } else if (fn !== undefined) {
        const activeFn = isShiftActive && shiftFn ? shiftFn : fn;
        
        if (activeFn === 'sin') expr = (expr === '0' ? '' : expr) + 'sin(';
        else if (activeFn === 'cos') expr = (expr === '0' ? '' : expr) + 'cos(';
        else if (activeFn === 'tan') expr = (expr === '0' ? '' : expr) + 'tan(';
        else if (activeFn === 'asin') expr = (expr === '0' ? '' : expr) + 'asin(';
        else if (activeFn === 'acos') expr = (expr === '0' ? '' : expr) + 'acos(';
        else if (activeFn === 'atan') expr = (expr === '0' ? '' : expr) + 'atan(';
        else if (activeFn === 'log') expr = (expr === '0' ? '' : expr) + 'log(';
        else if (activeFn === 'ln') expr = (expr === '0' ? '' : expr) + 'ln(';
        else if (activeFn === 'tenx') expr = (expr === '0' ? '' : expr) + '10^(';
        else if (activeFn === 'expx') expr = (expr === '0' ? '' : expr) + 'e^(';
        else if (activeFn === 'sqrt') expr = (expr === '0' ? '' : expr) + 'sqrt(';
        else if (activeFn === 'cbrt') expr = (expr === '0' ? '' : expr) + 'cbrt(';
        else if (activeFn === 'yroot') expr = (expr === '0' ? '' : expr) + ' yroot ';
        else if (activeFn === 'sqr') expr = expr + '^2';
        else if (activeFn === 'cube') expr = expr + '^3';
        else if (activeFn === 'fact') expr = expr + '!';
        else if (activeFn === 'inv') expr = expr + '^-1';

        updateDisplay();
      } else if (action) {
        if (action === 'clear') {
          expr = '0';
          isEvaluated = false;
          updateDisplay('');
        } else if (action === 'backspace') {
          if (expr.length > 1) {
            expr = expr.slice(0, -1);
          } else {
            expr = '0';
          }
          updateDisplay();
        } else if (action === 'percent') {
          expr += '%';
          updateDisplay();
        } else if (['add', 'subtract', 'multiply', 'divide'].includes(action)) {
          isEvaluated = false;
          const opsMap = { add: ' + ', subtract: ' − ', multiply: ' × ', divide: ' ÷ ' };
          
          if (/[\+\−\-\×\*\÷\/]\s*$/.test(expr.trim())) {
            expr = expr.trim().replace(/[\+\−\-\×\*\÷\/]\s*$/, '') + opsMap[action];
          } else {
            expr += opsMap[action];
          }
          updateDisplay();
        } else if (action === 'toggle-sign') {
          if (expr.startsWith('-')) expr = expr.slice(1);
          else expr = '-' + expr;
          updateDisplay();
        } else if (action === 'sci') {
          isSciMode = !isSciMode;
          if (btnSci) btnSci.classList.toggle('active', isSciMode);
          if (sciModeBadge) sciModeBadge.style.display = isSciMode ? 'inline-block' : 'none';

          let currentNum = parseFloat(expr);
          if (!isNaN(currentNum) && isFinite(currentNum)) {
            if (isSciMode) {
              expr = formatSci(currentNum);
            } else {
              expr = String(Math.round(currentNum * 1e10) / 1e10);
            }
          }
          updateDisplay();
        } else if (action === 'equals') {
          let prettyExpr = expr.trim().replace(/[\+\−\-\×\*\÷\/\^]+$/, '').trim();
          const openCount = (prettyExpr.match(/\(/g) || []).length;
          const closeCount = (prettyExpr.match(/\)/g) || []).length;
          if (openCount > closeCount) {
            prettyExpr += ')'.repeat(openCount - closeCount);
          }

          // Check if expression is an equation (contains variable 'x' or '=')
          if (prettyExpr.includes('x') || prettyExpr.includes('=')) {
            const sol = solveSingleEquation(prettyExpr);
            if (sol.success) {
              const historyText = `${prettyExpr} :`;
              expr = sol.shortAnswer;
              isEvaluated = true;
              updateDisplay(historyText);
              if (eqInputSingle) eqInputSingle.value = prettyExpr;
              return;
            }
          }

          const historyText = `${prettyExpr} =`;
          let result = evaluateExpression();
          if (result !== 'Error') {
            lastAns = result;
            if (isSciMode && typeof result === 'number') {
              result = formatSci(result);
            }
          }
          expr = String(result);
          isEvaluated = true;
          updateDisplay(historyText);
        }
      }
    };

    // Attach listeners to all keypad buttons
    calcWidget.querySelectorAll('.calc-btn').forEach(btn => {
      btn.addEventListener('click', () => handleCalcInput(btn));
    });

    // Copy Result
    if (calcCopy) {
      calcCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(expr);
          if (window.CustomDialog) {
            window.CustomDialog.toast('คัดลอกผลลัพธ์แล้ว');
          }
        } catch (e) {}
      });
    }

    // Insert Result to Page
    if (calcInsert) {
      calcInsert.addEventListener('click', () => {
        const view = this.canvasEngine.pageViews[this.currentPageIndex];
        if (!view) return;

        const exprText = historyEl.innerText ? `${historyEl.innerText} ${expr}` : expr;
        const tb = {
          id: `t-${Date.now()}`,
          x: (view.width / 2) - 100,
          y: (view.height / 2) - 30,
          text: exprText,
          fontSize: 24,
          color: window.ToolState.color || '#1C1C1E'
        };

        if (!view.pageData.textBoxes) view.pageData.textBoxes = [];
        view.pageData.textBoxes.push(tb);
        this.canvasEngine.renderPageTextOverlays(view);
        this.handlePageModified(this.currentPageIndex);

        if (window.CustomDialog) {
          window.CustomDialog.toast('แทรกคำนวณลงในโน้ตเรียบร้อย');
        }
      });
    }
  }
};

// ─── DYNAMIC ANIMATED FAVICON ENGINE ──────────────────────────────────────────
class AnimatedFavicon {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.ctx = this.canvas.getContext('2d');
    this.faviconEl = document.getElementById('dynamic-favicon');
    
    if (!this.faviconEl) {
      this.faviconEl = document.createElement('link');
      this.faviconEl.id = 'dynamic-favicon';
      this.faviconEl.rel = 'icon';
      this.faviconEl.type = 'image/png';
      document.head.appendChild(this.faviconEl);
    }
    
    this.frame = 0;
    this.startAnimation();
  }

  drawFrame() {
    const ctx = this.ctx;
    const t = this.frame * 0.12;
    
    ctx.clearRect(0, 0, 32, 32);

    // 1. Sleek Gradient Notebook Icon Base (#FF9500 -> #FF2D55)
    const gradient = ctx.createLinearGradient(0, 0, 32, 32);
    gradient.addColorStop(0, '#FF9500');
    gradient.addColorStop(1, '#FF2D55');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(1, 1, 30, 30, 7);
    else ctx.rect(1, 1, 30, 30);
    ctx.fill();

    // 2. White Inner Paper Card
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(5, 5, 22, 22, 4);
    else ctx.rect(5, 5, 22, 22);
    ctx.fill();

    // 3. Animated Writing Strokes (Simulates active note writing!)
    const line1W = 8 + (Math.sin(t) * 0.5 + 0.5) * 11;
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(8, 11);
    ctx.lineTo(line1W, 11);
    ctx.stroke();

    const line2W = 8 + (Math.cos(t * 0.8) * 0.5 + 0.5) * 12;
    ctx.strokeStyle = '#FF3B30';
    ctx.beginPath();
    ctx.moveTo(8, 16);
    ctx.lineTo(line2W, 16);
    ctx.stroke();

    const line3W = 8 + (Math.sin(t * 1.3) * 0.5 + 0.5) * 9;
    ctx.strokeStyle = '#34C759';
    ctx.beginPath();
    ctx.moveTo(8, 21);
    ctx.lineTo(line3W, 21);
    ctx.stroke();

    // 4. Glowing Pen Tip Sparkle
    const penX = line1W;
    const penY = 11;
    ctx.fillStyle = '#FFCC00';
    ctx.beginPath();
    ctx.arc(penX, penY, 2, 0, Math.PI * 2);
    ctx.fill();

    // 5. Update Favicon Link Data URL
    try {
      this.faviconEl.href = this.canvas.toDataURL('image/png');
    } catch(e) {}
    this.frame++;
  }

  startAnimation() {
    setInterval(() => {
      this.drawFrame();
    }, 80); // Smooth animation at ~12 FPS
  }
}

// Auto-start Animated Favicon
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    new AnimatedFavicon();
  } else {
    window.addEventListener('DOMContentLoaded', () => new AnimatedFavicon());
  }
} catch (err) {}

// ─── INTERACTIVE IMAGE CROPPER ENGINE ──────────────────────────────────────────
class ImageCropper {
  constructor() {
    this.modal = document.getElementById('crop-image-modal');
    this.canvas = document.getElementById('crop-canvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.btnApply = document.getElementById('btn-apply-crop');
    this.btnCancel = document.getElementById('btn-cancel-crop');
    this.btnClose = document.getElementById('btn-close-crop');
    this.btnRotate = document.getElementById('btn-crop-rotate');
    this.btnReset = document.getElementById('btn-crop-reset');

    this.image = null;
    this.cropBox = { x: 0, y: 0, w: 0, h: 0 };
    this.activeRatio = 'free';
    this.activeHandle = null;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.initBoxState = null;
    this.onCropComplete = null;

    this.initEvents();
  }

  open(imageSource, callback) {
    if (!this.modal || !this.canvas) return;
    this.onCropComplete = callback;
    this.activeRatio = 'free';

    document.querySelectorAll('.crop-ratio-btn').forEach(b => b.classList.remove('active'));
    const freeBtn = document.querySelector('.crop-ratio-btn[data-ratio="free"]');
    if (freeBtn) freeBtn.classList.add('active');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.image = img;
      this.modal.classList.remove('hidden');
      this.resetCropBox();
      this.render();
    };
    img.src = imageSource;
  }

  close() {
    if (this.modal) this.modal.classList.add('hidden');
    this.image = null;
  }

  resetCropBox() {
    if (!this.image) return;
    const w = this.image.width;
    const h = this.image.height;
    const margin = 0.05;
    this.cropBox = {
      x: Math.round(w * margin),
      y: Math.round(h * margin),
      w: Math.round(w * (1 - margin * 2)),
      h: Math.round(h * (1 - margin * 2))
    };
  }

  setRatio(ratioStr) {
    this.activeRatio = ratioStr;
    if (!this.image) return;

    if (ratioStr === 'free') {
      this.render();
      return;
    }

    const [rw, rh] = ratioStr.split(':').map(Number);
    const targetRatio = rw / rh;
    
    const imgW = this.image.width;
    const imgH = this.image.height;

    let newW = imgW * 0.9;
    let newH = newW / targetRatio;

    if (newH > imgH * 0.9) {
      newH = imgH * 0.9;
      newW = newH * targetRatio;
    }

    this.cropBox = {
      x: Math.round((imgW - newW) / 2),
      y: Math.round((imgH - newH) / 2),
      w: Math.round(newW),
      h: Math.round(newH)
    };
    this.render();
  }

  rotate90() {
    if (!this.image) return;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = this.image.height;
    offCanvas.height = this.image.width;
    const offCtx = offCanvas.getContext('2d');
    offCtx.translate(offCanvas.width / 2, offCanvas.height / 2);
    offCtx.rotate(Math.PI / 2);
    offCtx.drawImage(this.image, -this.image.width / 2, -this.image.height / 2);

    const rotatedImg = new Image();
    rotatedImg.onload = () => {
      this.image = rotatedImg;
      this.resetCropBox();
      this.render();
    };
    rotatedImg.src = offCanvas.toDataURL('image/png');
  }

  render() {
    if (!this.image || !this.canvas || !this.ctx) return;

    const container = document.getElementById('crop-workspace');
    const maxW = container.clientWidth || 800;
    const maxH = container.clientHeight || 450;

    const imgW = this.image.width;
    const imgH = this.image.height;

    const scale = Math.min(maxW / imgW, maxH / imgH);
    this.displayScale = scale;

    const dispW = Math.round(imgW * scale);
    const dispH = Math.round(imgH * scale);

    this.canvas.width = dispW;
    this.canvas.height = dispH;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, dispW, dispH);

    ctx.drawImage(this.image, 0, 0, dispW, dispH);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, dispW, dispH);

    const cb = this.cropBox;
    const cx = cb.x * scale;
    const cy = cb.y * scale;
    const cw = cb.w * scale;
    const ch = cb.h * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();
    ctx.drawImage(this.image, 0, 0, dispW, dispH);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + (cw * i / 3), cy);
      ctx.lineTo(cx + (cw * i / 3), cy + ch);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, cy + (ch * i / 3));
      ctx.lineTo(cx + cw, cy + (ch * i / 3));
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#FF9500';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(cx, cy, cw, ch);

    const handles = this.getHandlePositions(cx, cy, cw, ch);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#FF9500';
    ctx.lineWidth = 2;

    for (const key in handles) {
      const h = handles[key];
      ctx.beginPath();
      ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  getHandlePositions(cx, cy, cw, ch) {
    return {
      tl: { x: cx, y: cy },
      tr: { x: cx + cw, y: cy },
      bl: { x: cx, y: cy + ch },
      br: { x: cx + cw, y: cy + ch },
      mt: { x: cx + cw / 2, y: cy },
      mb: { x: cx + cw / 2, y: cy + ch },
      ml: { x: cx, y: cy + ch / 2 },
      mr: { x: cx + cw, y: cy + ch / 2 }
    };
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  initEvents() {
    if (!this.canvas) return;

    const onDown = (e) => {
      if (!this.image) return;
      const pt = this.getCanvasCoords(e);
      const scale = this.displayScale || 1;
      const cb = this.cropBox;
      const cx = cb.x * scale;
      const cy = cb.y * scale;
      const cw = cb.w * scale;
      const ch = cb.h * scale;

      const handles = this.getHandlePositions(cx, cy, cw, ch);
      this.activeHandle = null;

      for (const key in handles) {
        const h = handles[key];
        const dist = Math.hypot(pt.x - h.x, pt.y - h.y);
        if (dist <= 16) {
          this.activeHandle = key;
          break;
        }
      }

      if (!this.activeHandle && pt.x >= cx && pt.x <= cx + cw && pt.y >= cy && pt.y <= cy + ch) {
        this.activeHandle = 'move';
      }

      if (this.activeHandle) {
        this.isDragging = true;
        this.dragStart = pt;
        this.initBoxState = { ...this.cropBox };
      }
    };

    const onMove = (e) => {
      if (!this.isDragging || !this.image || !this.activeHandle) return;
      if (e.cancelable) e.preventDefault();
      const pt = this.getCanvasCoords(e);
      const scale = this.displayScale || 1;

      const dx = (pt.x - this.dragStart.x) / scale;
      const dy = (pt.y - this.dragStart.y) / scale;

      const imgW = this.image.width;
      const imgH = this.image.height;
      const init = this.initBoxState;

      let newX = init.x;
      let newY = init.y;
      let newW = init.w;
      let newH = init.h;

      if (this.activeHandle === 'move') {
        newX = Math.max(0, Math.min(imgW - init.w, init.x + dx));
        newY = Math.max(0, Math.min(imgH - init.h, init.y + dy));
      } else {
        if (this.activeHandle.includes('r')) newW = Math.max(30, Math.min(imgW - init.x, init.w + dx));
        if (this.activeHandle.includes('l')) {
          const tryW = Math.max(30, init.w - dx);
          newX = init.x + (init.w - tryW);
          newW = tryW;
        }
        if (this.activeHandle.includes('b')) newH = Math.max(30, Math.min(imgH - init.y, init.h + dy));
        if (this.activeHandle.includes('t')) {
          const tryH = Math.max(30, init.h - dy);
          newY = init.y + (init.h - tryH);
          newH = tryH;
        }

        if (this.activeRatio !== 'free') {
          const [rw, rh] = this.activeRatio.split(':').map(Number);
          const ratio = rw / rh;
          newH = newW / ratio;
        }
      }

      this.cropBox = {
        x: Math.round(newX),
        y: Math.round(newY),
        w: Math.round(newW),
        h: Math.round(newH)
      };
      this.render();
    };

    const onUp = () => {
      this.isDragging = false;
      this.activeHandle = null;
    };

    this.canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    this.canvas.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    document.querySelectorAll('.crop-ratio-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.crop-ratio-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setRatio(btn.dataset.ratio);
      });
    });

    if (this.btnRotate) this.btnRotate.addEventListener('click', () => this.rotate90());
    if (this.btnReset) this.btnReset.addEventListener('click', () => { this.resetCropBox(); this.render(); });

    const handleClose = () => this.close();
    if (this.btnCancel) this.btnCancel.addEventListener('click', handleClose);
    if (this.btnClose) this.btnClose.addEventListener('click', handleClose);

    if (this.btnApply) {
      this.btnApply.addEventListener('click', () => {
        if (!this.image) return;

        const cb = this.cropBox;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = Math.max(1, cb.w);
        outCanvas.height = Math.max(1, cb.h);

        const outCtx = outCanvas.getContext('2d');
        outCtx.drawImage(this.image, cb.x, cb.y, cb.w, cb.h, 0, 0, cb.w, cb.h);

        const croppedDataUrl = outCanvas.toDataURL('image/png');
        this.close();

        if (typeof this.onCropComplete === 'function') {
          this.onCropComplete(croppedDataUrl);
        }
      });
    }
  }
}

// Auto-instantiate ImageCropper
try {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.imageCropper = new ImageCropper();
  } else {
    window.addEventListener('DOMContentLoaded', () => window.imageCropper = new ImageCropper());
  }
} catch (err) {}

