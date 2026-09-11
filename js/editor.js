/**
 * Editor Controller — Unlimited Multi-Step Undo/Redo Engine (Strokes, Shapes, Images & Text)
 */

window.EditorController = class EditorController {
  constructor(app) {
    this.app = app;
    this.currentNotebook = null;
    this.pages = [];
    this.currentPageIndex = 0;

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

    this.currentPageIndex = 0;
    this.pageCounterText.innerText = `หน้า 1 / ${this.pages.length}`;
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoRedoButtons();

    await this.canvasEngine.loadPages(this.pages, window.Storage);
    this.renderThumbnails();
  }

  handleActivePageChanged(pageIndex) {
    this.currentPageIndex = pageIndex;
    this.pageCounterText.innerText = `หน้า ${pageIndex + 1} / ${this.pages.length}`;
    this.highlightActiveThumbnail(pageIndex);
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
    const page = this.pages[idx];
    if (!page) return;

    // Silent, fast background save to local IndexedDB (keeps work saved on F5 refresh, 0% lag, 0 popups)
    clearTimeout(this._dbSaveTimer);
    this._dbSaveTimer = setTimeout(async () => {
      try {
        await window.Storage.savePage(page);
        if (this.currentNotebook) {
          this.currentNotebook.pageCount = this.pages.length;
          await window.Storage.saveNotebook(this.currentNotebook);
        }
      } catch (e) {
        console.warn('Local DB save failed:', e);
      }
    }, 150);
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
      newTab.document.open();
      newTab.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>กำลังส่งรูปไปยัง Google Lens...</title>
<style>body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f8f9fa;color:#202124;}
.spinner{width:40px;height:40px;border:4px solid #e8eaed;border-top-color:#4285f4;border-radius:50%;animation:spin 0.8s linear infinite;margin:16px auto;}
@keyframes spin{to{transform:rotate(360deg);}}</style></head>
<body><div class="spinner"></div><p>กำลังเปิด Google Lens...</p>
<form id="f" method="POST" action="https://www.google.com/searchbyimage/upload" enctype="multipart/form-data" style="display:none">
<input type="file" id="fi" name="encoded_image"></form>
<script>
window.addEventListener('message', function(e) {
  if (!e.data || !e.data.buffer) return;
  var blob = new Blob([e.data.buffer], { type: 'image/png' });
  var file = new File([blob], 'selection.png', { type: 'image/png' });
  var dt = new DataTransfer(); dt.items.add(file);
  document.getElementById('fi').files = dt.files;
  document.getElementById('f').submit();
});
</script></body></html>`);
      newTab.document.close();
      const buffer = await this.lastLensBlob.arrayBuffer();
      setTimeout(() => newTab.postMessage({ type: 'lens-image', buffer }, '*', [buffer]), 100);
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
          this.lastLensUrl = `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imgUrl)}`;
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
    this.initGoogleLensDrawer();
    this.initCalculator();

    window.addEventListener('beforeunload', () => {
      const page = this.pages && this.pages[this.currentPageIndex];
      if (page) {
        window.Storage.savePage(page);
      }
    });

    document.getElementById('btn-back-library').addEventListener('click', () => {
      this.app.showLibrary();
    });

    this.titleInput.addEventListener('change', async () => {
      if (this.currentNotebook) {
        this.currentNotebook.title = this.titleInput.value.trim() || 'ไม่มีชื่อ';
        await window.Storage.saveNotebook(this.currentNotebook);
      }
    });

    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }
    });

    document.getElementById('btn-prev-page').addEventListener('click', () => {
      if (this.currentPageIndex > 0) {
        this.canvasEngine.scrollToPage(this.currentPageIndex - 1);
      }
    });

    document.getElementById('btn-next-page').addEventListener('click', () => {
      if (this.currentPageIndex < this.pages.length - 1) {
        this.canvasEngine.scrollToPage(this.currentPageIndex + 1);
      }
    });

    const addPageHandler = async () => {
      this.saveUndoState(this.currentPageIndex);
      const isLandscape = (this.currentNotebook && this.currentNotebook.orientation === 'landscape') ||
                          (this.pages && this.pages.length > 0 && this.pages[0].width > this.pages[0].height);
      const width = isLandscape ? 1123 : 794;
      const height = isLandscape ? 794 : 1123;

      const newPage = {
        id: `page-${this.currentNotebook.id}-${Date.now()}`,
        notebookId: this.currentNotebook.id,
        index: this.pages.length,
        width,
        height,
        template: this.currentNotebook.template || 'grid',
        strokes: [],
        textBoxes: [],
        images: []
      };
      await window.Storage.savePage(newPage);
      this.pages.push(newPage);

      await this.canvasEngine.loadPages(this.pages, window.Storage);
      this.renderThumbnails();
      this.canvasEngine.scrollToPage(this.pages.length - 1);
      // No auto-save — user saves manually
      if (this.saveStatus) {
        this.saveStatus.innerHTML = '<i class="fa-solid fa-circle-dot" style="color:#FF9500"></i> ยังไม่ได้บันทึก';
      }
    };

    document.getElementById('btn-add-page-top').addEventListener('click', addPageHandler);
    document.getElementById('btn-add-page-thumb').addEventListener('click', addPageHandler);

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

    document.querySelectorAll('#main-toolbar .tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;

        if (tool === 'image') {
          document.getElementById('image-file-input').click();
          return;
        }

        if (this.canvasEngine) {
          this.canvasEngine.clearSelection();
        }

        document.querySelectorAll('#main-toolbar .tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window.ToolState.currentTool = tool;

        this.updateToolbarSizeDots();
        this.updateToolColorIndicators();
        this.showToolPopover(tool, btn);
      });
    });

    window.selectTool = (tool) => {
      window.ToolState.currentTool = tool;
      document.querySelectorAll('#main-toolbar .tool-btn').forEach(b => b.classList.remove('active'));
      const btn = document.querySelector(`#main-toolbar .tool-btn[data-tool="${tool}"]`);
      if (btn) btn.classList.add('active');
      this.updateToolbarSizeDots();
      this.updateToolColorIndicators();
    };

    document.querySelectorAll('#quick-colors .color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
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
      dot.addEventListener('click', () => {
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
    const videoEl = document.getElementById('camera-video');
    const snapshotCanvas = document.getElementById('camera-snapshot-canvas');

    if (!btnCamera || !cameraModal || !videoEl) return;

    let mediaStream = null;
    let currentFacingMode = 'environment';

    const stopStream = () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
      if (videoEl) videoEl.srcObject = null;
    };

    const startCamera = async (facingMode = 'environment') => {
      stopStream();
      try {
        const constraints = {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoEl.srcObject = mediaStream;
        await videoEl.play();
      } catch (err) {
        console.error('Camera access error:', err);
        if (window.CustomDialog) {
          window.CustomDialog.alert('ไม่สามารถเข้าถึงกล้องได้', 'กรุณาอนุญาตการใช้งานกล้องในเบราว์เซอร์ของคุณ');
        }
        cameraModal.classList.add('hidden');
      }
    };

    btnCamera.addEventListener('click', () => {
      cameraModal.classList.remove('hidden');
      startCamera(currentFacingMode);
    });

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        stopStream();
        cameraModal.classList.add('hidden');
      });
    }

    cameraModal.addEventListener('click', (e) => {
      if (e.target === cameraModal) {
        stopStream();
        cameraModal.classList.add('hidden');
      }
    });

    if (btnSwitch) {
      btnSwitch.addEventListener('click', () => {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        startCamera(currentFacingMode);
      });
    }

    if (btnShutter) {
      btnShutter.addEventListener('click', () => {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;

        snapshotCanvas.width = videoEl.videoWidth;
        snapshotCanvas.height = videoEl.videoHeight;

        const ctx = snapshotCanvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, snapshotCanvas.width, snapshotCanvas.height);

        const dataUrl = snapshotCanvas.toDataURL('image/png');

        stopStream();
        cameraModal.classList.add('hidden');

        if (window.imageCropper) {
          window.imageCropper.open(dataUrl, (croppedUrl) => {
            if (this.canvasEngine) {
              this.saveUndoState(this.currentPageIndex);
              this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, croppedUrl);
              
              if (window.ToolState) window.ToolState.current = 'lasso';
              document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
              const lassoBtn = document.querySelector('.tool-btn[data-tool="lasso"]');
              if (lassoBtn) lassoBtn.classList.add('active');

              if (window.showToast) window.showToast('ครอบตัดและแทรกลงในโน้ตแล้ว');
            }
          });
        } else if (this.canvasEngine) {
          this.saveUndoState(this.currentPageIndex);
          this.canvasEngine.insertImageOverlay(this.canvasEngine.activePageIndex, dataUrl);
          
          if (window.ToolState) window.ToolState.current = 'lasso';
          document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
          const lassoBtn = document.querySelector('.tool-btn[data-tool="lasso"]');
          if (lassoBtn) lassoBtn.classList.add('active');

          if (window.showToast) window.showToast('ถ่ายภาพและแทรกลงในโน้ตแล้ว');
        }
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
    let targetZone = 'right';
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
        // Simple click without dragging -> cycle positions (right -> top -> left -> right)
        if (toolbarEl.classList.contains('pos-right')) {
          toolbarEl.className = 'editor-toolbar pos-top';
        } else if (toolbarEl.classList.contains('pos-top')) {
          toolbarEl.className = 'editor-toolbar pos-left';
        } else {
          toolbarEl.className = 'editor-toolbar pos-right';
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
      dot.addEventListener('click', () => {
        const hex = dot.dataset.color;
        hexInput.value = hex;
        applyBtn.click();
      });
    });

    // ── Toggle popover ────────────────────────────────────────────────────────

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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

    } else if (tool === 'highlighter') {
      const currentSize = window.ToolState.highlighterSize || 24;
      this.toolPopover.innerHTML = `
        <div class="form-group" style="margin-bottom:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="margin-bottom:0;">ขนาดปากกาไฮไลท์ (HIGHLIGHTER SIZE)</label>
            <span id="hl-size-val" style="font-size:13px; font-weight:600; color:#FF9500;">${currentSize}px</span>
          </div>
          <div class="option-chips-group" style="margin-bottom:10px;">
            <button class="option-chip ${currentSize <= 18 ? 'active' : ''}" data-size="14">บาง (14px)</button>
            <button class="option-chip ${currentSize > 18 && currentSize <= 30 ? 'active' : ''}" data-size="24">กลาง (24px)</button>
            <button class="option-chip ${currentSize > 30 ? 'active' : ''}" data-size="38">หนา (38px)</button>
          </div>
          <input type="range" id="hl-size-slider" min="6" max="60" value="${currentSize}" style="width:100%; accent-color:#FF9500; cursor:pointer;">
        </div>
      `;
      this.toolPopover.classList.remove('hidden');

      const slider = document.getElementById('hl-size-slider');
      const valText = document.getElementById('hl-size-val');

      if (slider) {
        slider.addEventListener('input', (e) => {
          const sz = parseInt(e.target.value, 10);
          window.ToolState.highlighterSize = sz;
          if (valText) valText.innerText = `${sz}px`;
          this.toolPopover.querySelectorAll('.option-chip').forEach(c => {
            const chipSize = parseInt(c.dataset.size, 10);
            c.classList.toggle('active', Math.abs(chipSize - sz) <= 3);
          });
          this.updateToolbarSizeDots();
          this.resetToolPopoverAutoFade();
        });
      }

      this.toolPopover.querySelectorAll('.option-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.toolPopover.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const sz = parseInt(chip.dataset.size, 10);
          window.ToolState.highlighterSize = sz;
          if (slider) slider.value = sz;
          if (valText) valText.innerText = `${sz}px`;
          this.updateToolbarSizeDots();
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
        e.stopPropagation();
        this.togglePageDropdownMenu(card, page, idx, dropdownBtn);
      });

      card.appendChild(thumbBox);
      card.appendChild(meta);

      // Attach Click Event Listener to the WHOLE CARD container
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-page-dropdown') || e.target.closest('.page-dropdown-menu')) return;
        const modal = document.getElementById('modal-page-overview');
        if (modal) modal.classList.add('hidden');
        if (this.canvasEngine && this.canvasEngine.scrollToPage) {
          this.canvasEngine.scrollToPage(idx);
        }
      });

      gridEl.appendChild(card);
    });
  }

  togglePageDropdownMenu(cardEl, page, pageIndex, dropdownBtn) {
    document.querySelectorAll('.page-dropdown-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'page-dropdown-menu';
    menu.innerHTML = `
      <button class="page-dropdown-item" data-action="add"><i class="fa-solid fa-plus" style="color:var(--gn-orange)"></i> แทรกหน้าต่อจากนี้</button>
      <button class="page-dropdown-item" data-action="duplicate"><i class="fa-solid fa-copy"></i> คัดลอกหน้านี้</button>
      <button class="page-dropdown-item danger" data-action="delete"><i class="fa-solid fa-trash-can"></i> ลบหน้านี้</button>
    `;

    menu.querySelectorAll('.page-dropdown-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
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
      const menuWidth = menu.offsetWidth || 170;

      let top;
      if (rect.bottom + menuHeight + 10 > window.innerHeight && rect.top > menuHeight) {
        top = rect.top - menuHeight - 4;
      } else {
        top = rect.bottom + 4;
      }
      top = Math.max(10, Math.min(top, window.innerHeight - menuHeight - 10));

      let left = rect.right - menuWidth;
      left = Math.max(10, Math.min(left, window.innerWidth - menuWidth - 10));

      menu.style.position = 'fixed';
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.zIndex = '99999';
    }

    const closeDropdownHandler = (evt) => {
      if (!menu.contains(evt.target) && evt.target !== dropdownBtn) {
        menu.remove();
        document.removeEventListener('click', closeDropdownHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeDropdownHandler), 10);
  }

  async insertPageAfter(pageIndex) {
    const newPage = {
      id: `page-${this.currentNotebook.id}-${Date.now()}`,
      notebookId: this.currentNotebook.id,
      index: pageIndex + 1,
      width: 794,
      height: 1123,
      template: this.currentNotebook.template || 'grid',
      strokes: [],
      textBoxes: [],
      images: []
    };
    this.pages.splice(pageIndex + 1, 0, newPage);
    this.pages.forEach((p, idx) => p.index = idx);

    await window.Storage.savePage(newPage);
    await this.canvasEngine.loadPages(this.pages, window.Storage);
    this.renderPageOverviewGrid();
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
    await this.canvasEngine.loadPages(this.pages, window.Storage);
    this.renderPageOverviewGrid();
    this.autoSave();
  }

  async deletePageAtIndex(pageIndex) {
    if (this.pages.length <= 1) {
      if (window.CustomDialog) {
        window.CustomDialog.alert('ไม่สามารถลบได้', 'สมุดโน้ตต้องมีอย่างน้อย 1 หน้า');
      }
      return;
    }

    const confirmed = await window.CustomDialog.confirm('ยืนยันลบหน้า', `คุณแน่ใจหรือไม่ว่าต้องการลบ หน้า ${pageIndex + 1}?`);
    if (!confirmed) return;

    const deleted = this.pages.splice(pageIndex, 1)[0];
    await window.Storage.deletePage(deleted.id);

    this.pages.forEach((p, idx) => p.index = idx);
    await this.canvasEngine.loadPages(this.pages, window.Storage);
    this.renderPageOverviewGrid();
    this.autoSave();
  }

  renderThumbnails() {
    this.renderPageOverviewGrid();
  }

  highlightActiveThumbnail(pageIndex) {
    // Grid handles active state automatically
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

    btnCalc.addEventListener('click', (e) => {
      e.stopPropagation();
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
    const calcBodyWrapper = document.getElementById('calc-body-wrapper');
    const sciKeypad = calcWidget.querySelector('.sci-keypad-8');
    const unitConverterPanel = document.getElementById('unit-converter-panel');

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

    if (tabCalc && tabConverter) {
      tabCalc.addEventListener('click', () => {
        tabCalc.classList.add('active');
        tabConverter.classList.remove('active');
        if (calcBodyWrapper) calcBodyWrapper.classList.remove('hidden');
        if (sciKeypad) sciKeypad.classList.remove('hidden');
        if (unitConverterPanel) unitConverterPanel.classList.add('hidden');
      });

      tabConverter.addEventListener('click', () => {
        tabConverter.classList.add('active');
        tabCalc.classList.remove('active');
        if (calcBodyWrapper) calcBodyWrapper.classList.add('hidden');
        if (sciKeypad) sciKeypad.classList.add('hidden');
        if (unitConverterPanel) unitConverterPanel.classList.remove('hidden');
        runUnitConversion();
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

