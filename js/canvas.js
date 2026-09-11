/**
 * GoodNotes Canvas Engine — Multi-Step Undo Snapshot Integration
 */

window.CanvasEngine = class CanvasEngine {
  constructor(listContainerId, options = {}) {
    this.pagesListContainer = document.getElementById(listContainerId);
    this.viewport = document.getElementById('canvas-viewport');

    this.pages = [];
    this.pageViews = [];

    this.zoom = 1.0;
    this.activePageIndex = 0;
    this.isDrawing = false;
    this.currentPoints = [];
    this.lastPointerTime = 0;

    // Multi-touch Pinch Zoom & 2-Finger Pan states
    this.isPinching = false;
    this.initialPinchDist = 0;
    this.initialZoom = 1.0;
    this.lastMidX = undefined;
    this.lastMidY = undefined;

    // Laser pointer states
    this.laserPoints = [];
    this.laserState = 'idle';
    this.laserAlpha = 1.0;
    this.laserAnimId = null;

    // Lasso selection, resizing & rotation states
    this.lassoPolygon = [];
    this.selectedStrokes = [];
    this.selectedImages = [];
    this.selectedTextBoxes = [];
    this.selectionBox = null;
    this.selectionAngle = 0;
    this.isDraggingSelection = false;
    this.isResizingSelection = false;
    this.isRotatingSelection = false;
    this.resizeHandle = null;
    this.dragStartPos = null;
    this.initSelectionState = null;

    // Google Lens Crop states
    this.isResizingLensBox = null;
    this.isDraggingLensBox = false;
    this.initLensBox = null;

    // Interactive Line Endpoint Adjuster state
    this.activeLineStroke = null;
    this.activeLineEndpoints = null;
    this.isAdjustingLineEndpoint = null;

    this.shapeHoldTimer = null;
    this.heldShape = null;

    this.bindKeyboardShortcuts();


    this.onBeforePageModified = options.onBeforePageModified || (() => {});
    this.onPageModified = options.onPageModified || (() => {});
    this.onActivePageChanged = options.onActivePageChanged || (() => {});
    this.onZoomChanged = options.onZoomChanged || (() => {});

    this.bindViewportScroll();
  }

  updateToolUI(toolName) {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      if (btn.dataset.tool === toolName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  restorePreviousToolIfEraser() {
    if (this.previousToolBeforeEraser) {
      const restoredTool = this.previousToolBeforeEraser;
      window.ToolState.currentTool = restoredTool;
      this.updateToolUI(restoredTool);
      this.previousToolBeforeEraser = null;
    }
  }

  getSmartFitZoom() {
    if (!this.viewport || !this.pageViews || !this.pageViews.length) return 1.0;
    
    let maxPageW = 794;
    this.pageViews.forEach(v => {
      if (v.width > maxPageW) maxPageW = v.width;
    });

    const vpWidth = this.viewport.clientWidth || window.innerWidth;
    const fitScale = (vpWidth - 60) / maxPageW;
    return Math.max(0.15, Math.min(1.0, fitScale));
  }

  zoomAtPoint(newLevel, focalClientX, focalClientY) {
    const oldZoom = this.zoom || 1.0;
    const nextZoom = Math.max(0.15, Math.min(3.0, newLevel));
    if (Math.abs(oldZoom - nextZoom) < 0.0001) return;

    const viewportRect = this.viewport.getBoundingClientRect();
    const focalVpX = (focalClientX !== undefined) ? (focalClientX - viewportRect.left) : (viewportRect.width  / 2);
    const focalVpY = (focalClientY !== undefined) ? (focalClientY - viewportRect.top)  : (viewportRect.height / 2);

    const scrollX = this.viewport.scrollLeft;
    const scrollY = this.viewport.scrollTop;

    const containerW = this.pagesListContainer.offsetWidth || 3600;
    const halfW = containerW / 2;

    const style = window.getComputedStyle(this.viewport);
    const paddingTop = parseFloat(style.paddingTop) || 300;

    // Unscaled content focal coordinates relative to transform-origin (center top)
    const Px = (focalVpX + scrollX - halfW) / oldZoom;
    const Py = (focalVpY + scrollY - paddingTop) / oldZoom;

    // Apply scale
    this.zoom = nextZoom;
    this.pagesListContainer.style.transform = `scale(${nextZoom})`;
    this.onZoomChanged(this.zoom);

    // Compute exact scroll position to keep focal point locked under cursor/fingers
    const newScrollX = halfW + Px * nextZoom - focalVpX;
    const newScrollY = paddingTop + Py * nextZoom - focalVpY;

    this.viewport.scrollLeft = Math.max(0, newScrollX);
    this.viewport.scrollTop  = Math.max(0, newScrollY);
  }

  pinchZoomAndPan(newLevel, currentMidX, currentMidY, lastMidX, lastMidY) {
    const oldZoom = this.zoom || 1.0;
    const nextZoom = Math.max(0.15, Math.min(3.0, newLevel));
    const viewportRect = this.viewport.getBoundingClientRect();

    const prevMidX = (lastMidX !== undefined) ? lastMidX : currentMidX;
    const prevMidY = (lastMidY !== undefined) ? lastMidY : currentMidY;

    const focalVpX = prevMidX - viewportRect.left;
    const focalVpY = prevMidY - viewportRect.top;

    const scrollX = this.viewport.scrollLeft;
    const scrollY = this.viewport.scrollTop;

    const containerW = this.pagesListContainer.offsetWidth || 3600;
    const halfW = containerW / 2;

    const style = window.getComputedStyle(this.viewport);
    const paddingTop = parseFloat(style.paddingTop) || 300;

    // Unscaled content focal coordinates relative to transform-origin (center top)
    const Px = (focalVpX + scrollX - halfW) / oldZoom;
    const Py = (focalVpY + scrollY - paddingTop) / oldZoom;

    // Apply scale
    this.zoom = nextZoom;
    this.pagesListContainer.style.transform = `scale(${nextZoom})`;
    this.onZoomChanged(this.zoom);

    // Current finger midpoint (includes 2-finger panning!)
    const curFocalVpX = currentMidX - viewportRect.left;
    const curFocalVpY = currentMidY - viewportRect.top;

    const newScrollX = halfW + Px * nextZoom - curFocalVpX;
    const newScrollY = paddingTop + Py * nextZoom - curFocalVpY;

    this.viewport.scrollLeft = Math.max(0, newScrollX);
    this.viewport.scrollTop  = Math.max(0, newScrollY);
  }

  setZoom(level) {
    if (!this.viewport) {
      this.zoom = Math.max(0.15, Math.min(3.0, level));
      this.pagesListContainer.style.transform = `scale(${this.zoom})`;
      this.onZoomChanged(this.zoom);
      return;
    }
    const viewportRect = this.viewport.getBoundingClientRect();
    const centerX = viewportRect.left + viewportRect.width / 2;
    const centerY = viewportRect.top + viewportRect.height / 2;
    this.zoomAtPoint(level, centerX, centerY);
    this._updateViewportPadding();
  }

  // Dynamically expands the gray workspace padding so there's always room to rest palm
  // when zoomed in. Base: 300px. At 3× zoom: 900px+ on each side.
  _updateViewportPadding() {
    if (!this.viewport) return;
    const z = this.zoom || 1.0;
    // Vertical palm-rest margin only — horizontal gray workspace comes from
    // canvas-pages-list min-width:3600px, not viewport padding.
    const vertPx = Math.round(Math.max(300, 280 * z));
    this.viewport.style.paddingTop    = `${vertPx}px`;
    this.viewport.style.paddingBottom = `${vertPx}px`;
    // Ensure horizontal padding stays 0 (CSS sets it but JS overrides to be safe)
    this.viewport.style.paddingLeft  = '0';
    this.viewport.style.paddingRight = '0';
  }


  clearSelection() {
    this.lassoPolygon = [];
    this.selectedStrokes = [];
    this.selectedImages = [];
    this.selectedTextBoxes = [];
    this.selectionBox = null;
    this.selectionAngle = 0;
    this.isDraggingSelection = false;
    this.isResizingSelection = false;
    this.isRotatingSelection = false;
    this.initSelectionState = null;
    this.activeLineStroke = null;
    this.activeLineEndpoints = null;
    this.isAdjustingLineEndpoint = null;
    this.pageViews.forEach(v => this.clearLayer(v.uiCtx, v));
  }

  deleteSelectedObjects(view) {
    if (!this.selectionBox || !view) return;

    this.onBeforePageModified(view.index);

    if (this.selectedStrokes.length > 0) {
      const ids = new Set(this.selectedStrokes.map(s => s.id));
      view.pageData.strokes = (view.pageData.strokes || []).filter(s => !ids.has(s.id));
    }

    if (this.selectedImages.length > 0) {
      const ids = new Set(this.selectedImages.map(img => img.id));
      view.pageData.images = (view.pageData.images || []).filter(img => !ids.has(img.id));
    }

    if (this.selectedTextBoxes.length > 0) {
      const ids = new Set(this.selectedTextBoxes.map(tb => tb.id));
      view.pageData.textBoxes = (view.pageData.textBoxes || []).filter(tb => !ids.has(tb.id));
    }

    this.clearSelection();
    this.renderPageStrokes(view);
    this.renderPageImages(view);
    this.renderPageTextOverlays(view);
    this.onPageModified(view.index);
  }

  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectionBox) {
        const activeView = this.pageViews[this.activePageIndex] || this.pageViews[0];
        if (activeView) {
          this.deleteSelectedObjects(activeView);
        }
      }
    });
  }




  async loadPages(pages, storage) {
    this.pages = pages;
    this.storage = storage;
    this.pagesListContainer.innerHTML = '';
    this.pageViews = [];

    // Dynamically calculate workspace min-width based on maximum page width (portrait/landscape)
    // so left & right gray workspace padding is ALWAYS 100% equal (1400px each)
    let maxW = 794;
    pages.forEach(p => {
      if (p.width && p.width > maxW) maxW = p.width;
    });
    const containerW = Math.max(3600, maxW + 2800);
    this.containerWidth = containerW;
    this.pagesListContainer.style.minWidth = `${containerW}px`;

    // Disconnect any previous IntersectionObserver
    if (this._pageObserver) {
      this._pageObserver.disconnect();
      this._pageObserver = null;
    }

    // Phase 1: Create lightweight placeholder containers for ALL pages (no canvas yet!)
    // This is instant — just divs with correct dimensions, no GPU memory allocated at all.
    for (let i = 0; i < pages.length; i++) {
      const pageData = pages[i];
      const view = this._createPagePlaceholder(pageData, i);
      this.pageViews.push(view);
      this.pagesListContainer.appendChild(view.container);
    }

    // Phase 2: Set up IntersectionObserver with Virtual VRAM Memory Recycling.
    // Canvases are created when a page enters viewport and destroyed when far away (>3 pages).
    // rootMargin 500px pre-loads ~1-2 pages above/below without thrashing on wide/landscape docs.
    this._pageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const idx = parseInt(entry.target.dataset.pageIndex, 10);
        const view = this.pageViews[idx];
        if (!view) return;

        if (entry.isIntersecting) {
          if (!view.canvasReady && !view.canvasLoading) {
            this._initPageCanvases(view);
          }
        } else {
          const currentIdx = this.activePageIndex || 0;
          const distFromCurrent = Math.abs(idx - currentIdx);
          // Recycle VRAM for pages more than 3 pages away from current scroll position
          if (distFromCurrent > 3 && view.canvasReady) {
            this._destroyPageCanvases(view);
          }
        }
      });
    }, {
      root: this.viewport,
      rootMargin: '500px 0px 500px 0px',
      threshold: 0
    });

    // Observe all page containers
    this.pageViews.forEach(view => this._pageObserver.observe(view.container));

    // ── Proactive VRAM Guard ─────────────────────────────────────────────────────
    // Throttled scroll handler runs eviction sweep in real-time.
    // NEVER evict pages currently intersecting the viewport to prevent thrashing loops!
    {
      let _vramGuardTimer = null;
      const _runVramGuard = () => {
        const currentIdx = this.activePageIndex || 0;
        const keepRange = 3;
        const vpRect = this.viewport ? this.viewport.getBoundingClientRect() : null;

        this.pageViews.forEach((v, i) => {
          if (v.canvasReady && Math.abs(i - currentIdx) > keepRange) {
            // Guard: never destroy if page container is actually visible in viewport!
            if (vpRect && v.container) {
              const cRect = v.container.getBoundingClientRect();
              const isVisibleInVp = (cRect.bottom >= vpRect.top - 200 && cRect.top <= vpRect.bottom + 200);
              if (isVisibleInVp) return;
            }
            this._destroyPageCanvases(v);
          }
        });
        _vramGuardTimer = null;
      };
      this.viewport.addEventListener('scroll', () => {
        // Update active page immediately on every scroll event
        this.updateActivePageOnScroll();
        // Throttle VRAM cleanup to at most every 100 ms
        if (!_vramGuardTimer) {
          _vramGuardTimer = setTimeout(_runVramGuard, 100);
        }
      }, { passive: true });
    }
    // ────────────────────────────────────────────────────────────────────────────


    // Phase 3: Eagerly initialize page 1 (and page 2) RIGHT NOW so screen is never blank
    await this._initPageCanvases(this.pageViews[0]);
    if (this.pageViews.length > 1) {
      this._initPageCanvases(this.pageViews[1]); // async, no await
    }

    // Auto-fit zoom if document contains landscape or wide pages
    if (maxW > (this.viewport.clientWidth - 80)) {
      const autoFit = this.getSmartFitZoom();
      this.zoom = autoFit;
      this.pagesListContainer.style.transform = `scale(${this.zoom})`;
      this.onZoomChanged(this.zoom);
    }

    this.updateActivePageOnScroll();

    // Center viewport on Page 1 after layout settles
    requestAnimationFrame(() => {
      if (!this.viewport) return;
      this._updateViewportPadding();

      requestAnimationFrame(() => {
        if (!this.viewport) return;

        // Horizontal: center within the 3600px pages-list → equal gray on left/right
        // scrollWidth ≈ 3600px (min-width), clientWidth ≈ viewport width
        const maxScrollX = this.viewport.scrollWidth - this.viewport.clientWidth;
        this.viewport.scrollLeft = Math.max(0, maxScrollX / 2);

        // Vertical: jump to just above page 1 (within top padding area)
        const firstContainer = this.pageViews[0] && this.pageViews[0].container;
        if (firstContainer) {
          // offsetTop is relative to pagesListContainer which starts at paddingTop of viewport
          const vPad = parseInt(this.viewport.style.paddingTop || '300', 10);
          this.viewport.scrollTop = Math.max(0, vPad - 30);
        }

        this.updateActivePageOnScroll();
      });
    });
  }

  // Creates a lightweight page placeholder div (no canvas, no GPU memory)
  _createPagePlaceholder(pageData, index) {
    const width  = pageData.width  || 794;
    const height = pageData.height || 1123;
    // Landscape pages (wider than tall) use lower DPR to prevent GPU memory exhaustion.
    // Landscape at 1.75x is razor-sharp while cutting texture memory in half vs 3.0x.
    const isLandscape = width > height;
    // Deliver Retina sharpness on every display: minimum 2.0x DPR
    const deviceDpr = window.devicePixelRatio || 1;
    const dpr = isLandscape
      ? Math.max(2.0, Math.min(2.0, deviceDpr))
      : Math.max(2.0, Math.min(2.5, deviceDpr * 1.25));

    const container = document.createElement('div');
    container.className = 'page-container';
    container.dataset.pageIndex = index;
    container.style.width  = `${width}px`;
    container.style.height = `${height}px`;
    // Show a white background so the placeholder looks like a blank page while canvas loads
    container.style.background = '#FFFFFF';

    const imageOverlays = document.createElement('div');
    imageOverlays.className = 'image-overlays-container';

    const textOverlays = document.createElement('div');
    textOverlays.className = 'text-overlays-container';

    const pageTag = document.createElement('div');
    pageTag.className = 'page-number-tag';
    pageTag.innerText = `หน้า ${index + 1}`;

    container.appendChild(imageOverlays);
    container.appendChild(textOverlays);
    container.appendChild(pageTag);

    const view = {
      index,
      pageData,
      width,
      height,
      dpr,
      container,
      imageOverlays,
      textOverlays,
      bgCanvas: null, strokeCanvas: null, activeCanvas: null, uiCanvas: null,
      bgCtx: null,    strokeCtx: null,    activeCtx: null,    uiCtx: null,
      canvasReady:   false,
      canvasLoading: false,
    };

    this.bindPagePointerEvents(view); // safe: bindPagePointerEvents checks if uiCanvas exists
    return view;
  }

  // Lazily creates the 4 canvas elements for a page when it enters the viewport.
  // Safe to call multiple times — guarded by canvasReady / canvasLoading flags and renderSession token.
  async _initPageCanvases(view) {
    if (!view || view.canvasReady || view.canvasLoading) return;
    view.canvasLoading = true;
    view._renderSession = (view._renderSession || 0) + 1;
    const session = view._renderSession;

    const { width, height, dpr, pageData, container } = view;

    const setupCanvas = (cls) => {
      const c = document.createElement('canvas');
      c.className = cls;
      c.width  = Math.round(width  * dpr);
      c.height = Math.round(height * dpr);
      c.style.width  = '100%';
      c.style.height = '100%';
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      return { c, ctx };
    };

    const { c: bgCanvas,     ctx: bgCtx     } = setupCanvas('bg-canvas');
    const { c: strokeCanvas, ctx: strokeCtx } = setupCanvas('stroke-canvas');
    const { c: activeCanvas, ctx: activeCtx } = setupCanvas('active-canvas');
    const { c: uiCanvas,     ctx: uiCtx     } = setupCanvas('ui-canvas');

    // Immediately fill background canvas with solid white so there is NEVER a black flash or transparent gap
    bgCtx.save();
    bgCtx.fillStyle = '#FFFFFF';
    bgCtx.fillRect(0, 0, width, height);
    bgCtx.restore();

    // Insert canvases before overlays - KEEP container white background for safety
    container.insertBefore(bgCanvas,     view.imageOverlays);
    container.insertBefore(strokeCanvas, view.imageOverlays);
    container.insertBefore(activeCanvas, view.imageOverlays);
    container.insertBefore(uiCanvas,     view.imageOverlays);
    container.style.background = '#FFFFFF';

    view.bgCanvas     = bgCanvas;
    view.strokeCanvas = strokeCanvas;
    view.activeCanvas = activeCanvas;
    view.uiCanvas     = uiCanvas;
    view.bgCtx        = bgCtx;
    view.strokeCtx    = strokeCtx;
    view.activeCtx    = activeCtx;
    view.uiCtx        = uiCtx;

    // Draw background
    if (pageData.pdfAssetId && this.storage) {
      try {
        const blob = await this.storage.getAsset(pageData.pdfAssetId);
        if (view._renderSession !== session || !view.bgCanvas) return;

        if (blob) {
          const imgUrl = URL.createObjectURL(blob);
          await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              if (view._renderSession === session && view.bgCtx) {
                view.bgCtx.drawImage(img, 0, 0, width, height);
              }
              URL.revokeObjectURL(imgUrl);
              resolve();
            };
            img.onerror = () => {
              URL.revokeObjectURL(imgUrl);
              resolve();
            };
            img.src = imgUrl;
          });
        } else {
          // On-demand rendering fallback using shared PDFEngine._docCache
          let renderedOnDemand = false;
          try {
            const pdfDoc = window.PDFEngine && typeof window.PDFEngine.getPDFDoc === 'function'
              ? await window.PDFEngine.getPDFDoc(pageData.notebookId, this.storage)
              : null;

            if (view._renderSession !== session || !view.bgCanvas) return;

            if (pdfDoc) {
              const pdfPage = await pdfDoc.getPage(view.index + 1);
              const renderVp = pdfPage.getViewport({ scale: 2.2 });
              const rW = Math.round(renderVp.width);
              const rH = Math.round(renderVp.height);

              const renderCanvas = document.createElement('canvas');
              renderCanvas.width = rW;
              renderCanvas.height = rH;
              const rCtx = renderCanvas.getContext('2d');
              rCtx.fillStyle = '#FFFFFF';
              rCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
              await pdfPage.render({ canvasContext: rCtx, viewport: renderVp }).promise;

              if (view._renderSession === session && view.bgCtx) {
                view.bgCtx.drawImage(renderCanvas, 0, 0, width, height);
              }

              let newBlob = await new Promise(r => renderCanvas.toBlob(r, 'image/webp', 0.96));
              if (!newBlob) {
                newBlob = await new Promise(r => renderCanvas.toBlob(r, 'image/png'));
              }
              await this.storage.saveAsset(pageData.pdfAssetId, newBlob);
              renderedOnDemand = true;
            }
          } catch (e) {
            console.warn('On-demand PDF render failed:', e);
          }

          if (view._renderSession !== session || !view.bgCanvas) return;

          if (!renderedOnDemand) {
            this.drawTemplateBackground(bgCtx, pageData.template || 'grid', width, height);
          }
        }
      } catch(e) {
        if (view._renderSession !== session || !view.bgCanvas) return;
        this.drawTemplateBackground(bgCtx, pageData.template || 'grid', width, height);
      }
    } else {
      this.drawTemplateBackground(bgCtx, pageData.template || 'grid', width, height);
    }

    if (view._renderSession !== session || !view.bgCanvas) return;

    this.renderPageStrokes(view);
    this.renderPageTextOverlays(view);
    this.renderPageImages(view);

    // Bind pointer events NOW that uiCanvas exists
    this.bindPagePointerEvents(view);

    view.canvasReady   = true;
    view.canvasLoading = false;
  }

  // Safely destroys canvas DOM elements and releases GPU VRAM backing store memory
  // when a page scrolls far outside the active viewport (>3 pages away).
  _destroyPageCanvases(view) {
    if (!view) return;
    view._renderSession = (view._renderSession || 0) + 1; // Invalidate any in-flight async render
    view.canvasReady   = false;
    view.canvasLoading = false;

    if (view.bgCanvas)     { view.bgCanvas.remove();     view.bgCanvas = null;     view.bgCtx = null; }
    if (view.strokeCanvas) { view.strokeCanvas.remove(); view.strokeCanvas = null; view.strokeCtx = null; }
    if (view.activeCanvas) { view.activeCanvas.remove(); view.activeCanvas = null; view.activeCtx = null; }
    if (view.uiCanvas)     { view.uiCanvas.remove();     view.uiCanvas = null;     view.uiCtx = null; }

    view.container.style.background = '#FFFFFF'; // Restore placeholder white bg
  }

  // Legacy alias kept for any internal callers (zoom, addPage, etc.)
  async createPageView(pageData, index, storage) {
    const view = this._createPagePlaceholder(pageData, index);
    await this._initPageCanvases(view);
    return view;
  }


  drawTemplateBackground(ctx, templateType, width, height) {
    ctx.save();
    if (templateType === 'dark-grid') {
      ctx.fillStyle = '#1C1C1E';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#2C2C2E';
      ctx.lineWidth = 1;
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#E5E5EA';
      ctx.lineWidth = 1;
    }

    const gridSpacing = 28;

    if (templateType === 'lined') {
      for (let y = 80; y < height - 40; y += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(width - 40, y); ctx.stroke();
      }
      ctx.strokeStyle = '#FF2D55';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(80, 0); ctx.lineTo(80, height); ctx.stroke();

    } else if (templateType === 'grid' || templateType === 'dark-grid') {
      for (let x = 0; x < width; x += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

    } else if (templateType === 'dotted') {
      ctx.fillStyle = templateType === 'dark-grid' ? '#545458' : '#C7C7CC';
      for (let x = 20; x < width; x += gridSpacing) {
        for (let y = 20; y < height; y += gridSpacing) {
          ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
        }
      }

    } else if (templateType === 'cornell') {
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(220, 80); ctx.lineTo(220, height - 140); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(40, height - 140); ctx.lineTo(width - 40, height - 140); ctx.stroke();
      
      ctx.strokeStyle = '#E5E5EA';
      ctx.lineWidth = 1;
      for (let y = 90; y < height - 150; y += gridSpacing) {
        ctx.beginPath(); ctx.moveTo(230, y); ctx.lineTo(width - 40, y); ctx.stroke();
      }
    }

    ctx.restore();
  }

  getCanvasCoords(e, view) {
    const el = view.uiCanvas || view.container;
    const rect = el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / this.zoom,
      y: (e.clientY - rect.top) / this.zoom,
      pressure: e.pressure > 0 ? e.pressure : 0.5
    };
  }

  bindPagePointerEvents(view) {
    // uiCanvas must exist before binding pointer events!
    const target = view.uiCanvas;
    if (!target) return;

    target.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        this.isPinching = true;
        this.isDrawing = false;
        this.currentPoints = [];
        this.clearLayer(view.activeCtx, view);

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        this.initialZoom = this.zoom;

        this.lastMidX = (t1.clientX + t2.clientX) / 2;
        this.lastMidY = (t1.clientY + t2.clientY) / 2;

        // Clear any single-touch scroll state when pinch starts
        this._touchScrollStart = null;
        return;
      }

      // Single finger on canvas → track for manual scrolling
      // Only start scroll tracking if pen is NOT currently drawing
      if (e.touches.length === 1 && !this.isPinching && !this.isDrawing) {
        this._touchScrollStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    target.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) {
        this.isPinching = true;
        this.isDrawing = false;
        this.currentPoints = [];
        this.clearLayer(view.activeCtx, view);

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        const currentMidX = (t1.clientX + t2.clientX) / 2;
        const currentMidY = (t1.clientY + t2.clientY) / 2;
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

        if (this.initialPinchDist > 0) {
          const scale = currentDist / this.initialPinchDist;
          const newZoom = this.initialZoom * scale;
          this.pinchZoomAndPan(newZoom, currentMidX, currentMidY, this.lastMidX, this.lastMidY);

          this.lastMidX = currentMidX;
          this.lastMidY = currentMidY;
        }

        // Clear single-touch scroll when pinching
        this._touchScrollStart = null;

        if (e.cancelable) e.preventDefault();
        return;
      }

      // Single finger → manually scroll the viewport (since touch-action:none prevents browser scroll)
      // Guard: isDrawing=true means stylus is active — do NOT scroll while pen is drawing!
      if (e.touches.length === 1 && this._touchScrollStart && !this.isPinching && !this.isDrawing) {
        const dx = this._touchScrollStart.x - e.touches[0].clientX;
        const dy = this._touchScrollStart.y - e.touches[0].clientY;
        this.viewport.scrollBy(dx, dy);
        this._touchScrollStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: true });

    target.addEventListener('touchend', (e) => {
      // Clear single-touch scroll state
      this._touchScrollStart = null;

      if (e.touches.length < 2) {
        // Reset pinch state with a short delay so any lingering pointerdown from
        // the last finger lift doesn't get blocked by isPinching still being true
        setTimeout(() => {
          this.isPinching = false;
          this.initialPinchDist = 0;
          this.lastMidX = undefined;
          this.lastMidY = undefined;
        }, 60);
      }
    });

    target.addEventListener('touchcancel', () => {
      this.isPinching = false;
      this.initialPinchDist = 0;
      this.lastMidX = undefined;
      this.lastMidY = undefined;
    });

    target.addEventListener('pointerdown', (e) => {
      // Stylus Eraser Tail Detection (Chromebook USI / EMR Eraser tail end)
      const isEraserTail = (e.pointerType === 'eraser') || (e.button === 5) || ((e.buttons & 32) === 32);
      if (isEraserTail) {
        if (window.ToolState.currentTool !== 'eraser') {
          this.previousToolBeforeEraser = window.ToolState.currentTool;
          window.ToolState.currentTool = 'eraser';
          this.updateToolUI('eraser');
        }
      }

      const popover = document.getElementById('tool-popover');
      if (popover) popover.classList.add('hidden');

      const pt = this.getCanvasCoords(e, view);


      // Text Box -> Lasso Tool Bounding Box integration
      if (view.pageData && view.pageData.textBoxes && view.pageData.textBoxes.length > 0) {
        const editingBox = view.pageData.textBoxes.find(tb => tb.state === 'editing');
        if (editingBox) {
          const txt = (editingBox.text || '').trim();
          if (!txt || txt === 'พิมพ์ข้อความที่นี่...') {
            view.pageData.textBoxes = view.pageData.textBoxes.filter(tb => tb.id !== editingBox.id);
            this.renderPageTextOverlays(view);
          } else {
            editingBox.text = txt;
            this.selectTextBoxInLasso(view, editingBox);
          }
          this.onPageModified(view.index);
          return;
        }
      }

      if (view.pageData && view.pageData.images && view.pageData.images.length > 0) {
        const selectedImg = view.pageData.images.find(img => img.state === 'selected');
        if (selectedImg) {
          selectedImg.state = 'confirmed';
          this.renderPageImages(view);
          if (window.ToolState.currentTool !== 'text') return;
        }
      }

      const handleHit = this.hitTestSelectionHandles(pt);
      if (handleHit) {
        if (handleHit === 'crop') {
          if (e.cancelable) e.preventDefault();
          this.isDrawing = false;
          const targetImg = this.selectedImages ? this.selectedImages[0] : null;
          if (targetImg && window.imageCropper) {
            window.imageCropper.open(targetImg.src, (croppedDataUrl) => {
              this.onBeforePageModified(view.index);
              const imgEl = new Image();
              imgEl.onload = () => {
                const oldW = targetImg.w;
                targetImg.src = croppedDataUrl;
                targetImg.naturalWidth = imgEl.naturalWidth;
                targetImg.naturalHeight = imgEl.naturalHeight;
                targetImg.h = Math.round(oldW * (imgEl.naturalHeight / imgEl.naturalWidth));
                this.computeSelectionBoundingBox();
                this.renderPageImages(view);
                this.renderSelectionBoundingBox(view);
                this.onPageModified(view.index);
              };
              imgEl.src = croppedDataUrl;
            });
          }
          return;
        }
        if (handleHit === 'copy') {
          if (e.cancelable) e.preventDefault();
          this.isDrawing = false;
          this.copySelectedObjects(view);
          return;
        }
        if (handleHit === 'delete') {
          if (e.cancelable) e.preventDefault();
          this.isDrawing = false;
          this.deleteSelectedObjects(view);
          return;
        }


        this.onBeforePageModified(view.index);
        this.activePageIndex = view.index;
        this.isDrawing = true;
        if (handleHit === 'line-p1' || handleHit === 'line-p2') {
          this.isAdjustingLineEndpoint = handleHit;
        } else if (handleHit === 'rotate') {
          this.isRotatingSelection = true;
        } else {
          this.isResizingSelection = true;
          this.resizeHandle = handleHit;
        }
        this.dragStartPos = pt;
        this.snapshotInitSelectionState();
        target.setPointerCapture(e.pointerId);
        if (e.cancelable) e.preventDefault();
        return;
      }
 else if (this.activeLineEndpoints) {
        // Confirm line edit & hide endpoint handles 🔵 when clicking elsewhere!
        this.activeLineEndpoints = null;
        this.activeLineStroke = null;
        this.clearLayer(view.uiCtx, view);
      }

      if (this.selectionBox) {



        const cx = this.selectionBox.x + this.selectionBox.w / 2;
        const cy = this.selectionBox.y + this.selectionBox.h / 2;
        const cos = Math.cos(-this.selectionAngle || 0);
        const sin = Math.sin(-this.selectionAngle || 0);
        const localPtX = cx + (pt.x - cx) * cos - (pt.y - cy) * sin;
        const localPtY = cy + (pt.x - cx) * sin + (pt.y - cy) * cos;

        if (localPtX >= this.selectionBox.x && localPtX <= this.selectionBox.x + this.selectionBox.w &&
            localPtY >= this.selectionBox.y && localPtY <= this.selectionBox.y + this.selectionBox.h) {
          this.onBeforePageModified(view.index);
          this.activePageIndex = view.index;
          this.isDrawing = true;
          this.isDraggingSelection = true;
          this.dragStartPos = pt;
          this.snapshotInitSelectionState();
          target.setPointerCapture(e.pointerId);
          if (e.cancelable) e.preventDefault();
          return;
        }


        this.clearSelection();
      }

      if (window.ToolState.currentTool === 'text') {
        this.addTextBox(view, pt.x, pt.y);
        return;
      }

      if (e.pointerType === 'touch') {
        return;
      }

      // Pen/Stylus: always clear any stale isPinching state immediately
      // (stylus doesn't go through touchend so isPinching might be stuck true)
      if (e.pointerType === 'pen' || e.pointerType === 'eraser') {
        this.isPinching = false;
        this.initialPinchDist = 0;
        // Also clear any lingering touch-scroll state — stylus fired touchstart on some ChromeOS
        // devices which would set _touchScrollStart; wipe it so page doesn't scroll while drawing
        this._touchScrollStart = null;
      }

      if (this.isPinching) return;
      if (e.cancelable) e.preventDefault();
      target.setPointerCapture(e.pointerId);


      this.activePageIndex = view.index;
      this.onActivePageChanged(view.index);

      this.isDrawing = true;
      this.currentPoints = [pt];
      this.lastPointerTime = Date.now();
      if (this.shapeHoldTimer) clearTimeout(this.shapeHoldTimer);
      this.heldShape = null;


      // SAVE UNDO SNAPSHOT BEFORE NEW DRAWING ACTION BEGINS!
      if (window.ToolState.currentTool === 'pen' || 
          window.ToolState.currentTool === 'highlighter' || 
          window.ToolState.currentTool === 'pencil' || 
          window.ToolState.currentTool === 'eraser' || 
          window.ToolState.currentTool === 'shape') {
        this.onBeforePageModified(view.index);
      }

      if (window.ToolState.currentTool === 'laser') {
        if (this.laserAnimId) cancelAnimationFrame(this.laserAnimId);
        this.laserPoints = [pt];
        this.laserState = 'drawing';
        this.laserAlpha = 1.0;
        this.renderLaserLine(view);
        return;
      }

      if (window.ToolState.currentTool === 'lasso') {
        this.lassoPolygon = [pt];
        this.selectedStrokes = [];
        this.selectedImages = [];
        this.selectedTextBoxes = [];
        this.selectionBox = null;
        this.clearLayer(view.uiCtx, view);
        return;
      }

      if (window.ToolState.currentTool === 'lens') {
        if (this.lensCropBox) {
          let { x, y, w, h } = this.lensCropBox;
          const realX = w < 0 ? x + w : x;
          const realY = h < 0 ? y + h : y;
          const realW = Math.abs(w);
          const realH = Math.abs(h);

          // 1. Check if clicking the actual Search Pill Button ONLY!
          if (realW >= 50 && realH >= 30) {
            const btnW = Math.min(realW - 16, 210);
            const btnH = 36;
            const btnX = realX + (realW - btnW) / 2;
            const btnY = realY + (realH - btnH) / 2;

            if (pt.x >= btnX && pt.x <= btnX + btnW && pt.y >= btnY && pt.y <= btnY + btnH) {
              if (e.cancelable) e.preventDefault();
              this.searchWithGoogleLens(view);
              return;
            }
          }

          // 2. Check if clicking any of the 4 corner handles for resizing
          const handleRadius = 24;
          const corners = [
            { id: 'tl', cx: realX, cy: realY },
            { id: 'tr', cx: realX + realW, cy: realY },
            { id: 'br', cx: realX + realW, cy: realY + realH },
            { id: 'bl', cx: realX, cy: realY + realH }
          ];

          let hitCorner = null;
          for (const c of corners) {
            if (Math.hypot(pt.x - c.cx, pt.y - c.cy) <= handleRadius) {
              hitCorner = c.id;
              break;
            }
          }

          if (hitCorner) {
            this.isResizingLensBox = hitCorner;
            this.initLensBox = { x: realX, y: realY, w: realW, h: realH };
            this.dragStartPos = pt;
            this.activePageIndex = view.index;
            this.isDrawing = true;
            target.setPointerCapture(e.pointerId);
            if (e.cancelable) e.preventDefault();
            return;
          }

          // 3. Check if clicking inside the box to drag/move the box
          if (pt.x >= realX && pt.x <= realX + realW && pt.y >= realY && pt.y <= realY + realH) {
            this.isDraggingLensBox = true;
            this.initLensBox = { x: realX, y: realY, w: realW, h: realH };
            this.dragStartPos = pt;
            this.activePageIndex = view.index;
            this.isDrawing = true;
            target.setPointerCapture(e.pointerId);
            if (e.cancelable) e.preventDefault();
            return;
          }
        }

        // 4. Otherwise, start dragging a new Google Lens crop box from this point
        this.lensCropBox = { x: pt.x, y: pt.y, w: 0, h: 0 };
        this.isResizingLensBox = null;
        this.isDraggingLensBox = false;
        this.activePageIndex = view.index;
        this.isDrawing = true;
        target.setPointerCapture(e.pointerId);
        if (e.cancelable) e.preventDefault();
        return;
      }

      if (window.ToolState.currentTool === 'eraser') {
        this.eraseStrokesAndImagesAtPoint(view, pt);
        if (window.ToolState.eraserMode === 'pixel') {
          this.pixelErase(view, pt);
        }
        return;
      }
    }, { passive: false });

    target.addEventListener('pointermove', (e) => {
      if (this.isPinching) return;

      const pt = this.getCanvasCoords(e, view);

      if (this.isAdjustingLineEndpoint && this.activeLineEndpoints && this.activeLineStroke) {
        if (e.cancelable) e.preventDefault();

        const anchor = (this.isAdjustingLineEndpoint === 'line-p1') ? this.activeLineEndpoints.p2 : this.activeLineEndpoints.p1;
        const snapped = this.snapLineAngle(anchor.x, anchor.y, pt.x, pt.y);

        if (this.isAdjustingLineEndpoint === 'line-p1') {
          this.activeLineEndpoints.p1 = { x: snapped.x2, y: snapped.y2 };
        } else {
          this.activeLineEndpoints.p2 = { x: snapped.x2, y: snapped.y2 };
        }

        const p1 = this.activeLineEndpoints.p1;
        const p2 = this.activeLineEndpoints.p2;
        const steps = 20;
        const newPoints = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          newPoints.push({
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t,
            pressure: 0.8
          });
        }
        this.activeLineStroke.points = newPoints;

        this.renderPageStrokes(view);
        this.renderLineEndpoints(view);
        return;
      }

      if (this.isResizingSelection || this.isDraggingSelection || this.isRotatingSelection) {

        if (e.cancelable) e.preventDefault();

        if (this.isRotatingSelection && this.dragStartPos && this.initSelectionState && this.selectionBox) {
          const centerX = this.initSelectionState.box.x + this.initSelectionState.box.w / 2;
          const centerY = this.initSelectionState.box.y + this.initSelectionState.box.h / 2;

          const initAngle = Math.atan2(this.dragStartPos.y - centerY, this.dragStartPos.x - centerX);
          const currentAngle = Math.atan2(pt.y - centerY, pt.x - centerX);
          const angleRad = currentAngle - initAngle;

          this.applySelectionRotate(angleRad, centerX, centerY, view);
          return;
        }

        if (this.isResizingSelection && this.dragStartPos && this.initSelectionState) {
          const dx = pt.x - this.dragStartPos.x;
          const dy = pt.y - this.dragStartPos.y;
          this.applySelectionResize(dx, dy, view);
          return;
        }

        if (this.isDraggingSelection && this.dragStartPos && this.selectionBox && this.initSelectionState) {
          const dx = pt.x - this.dragStartPos.x;
          const dy = pt.y - this.dragStartPos.y;

          this.selectionBox.x = this.initSelectionState.box.x + dx;
          this.selectionBox.y = this.initSelectionState.box.y + dy;

          this.selectedImages.forEach((img, idx) => {
            const initImg = this.initSelectionState.images[idx];
            img.x = initImg.x + dx;
            img.y = initImg.y + dy;
            if (img._el) {
              img._el.style.left = `${img.x}px`;
              img._el.style.top = `${img.y}px`;
            }
          });

          this.selectedTextBoxes.forEach((tb, idx) => {
            const initTb = this.initSelectionState.textBoxes[idx];
            tb.x = initTb.x + dx;
            tb.y = initTb.y + dy;
            if (tb._el) {
              tb._el.style.left = `${tb.x}px`;
              tb._el.style.top = `${tb.y}px`;
            }
          });

          this.renderSelectionDragPreview(view, dx, dy);
          return;
        }
      }


      if (e.pointerType === 'touch' || window.ToolState.currentTool === 'text') return;
      if (!this.isDrawing || this.activePageIndex !== view.index) return;
      if (e.cancelable) e.preventDefault();

      if (window.ToolState.currentTool === 'laser') {
        this.laserPoints.push(pt);
        this.renderLaserLine(view);
        return;
      }

      if (window.ToolState.currentTool === 'lasso') {
        const last = this.lassoPolygon[this.lassoPolygon.length - 1];
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 3) {
          this.lassoPolygon.push(pt);
          this.renderLassoFreehandPath(view);
        }
        return;
      }

      if (window.ToolState.currentTool === 'lens' && this.isDrawing && this.lensCropBox) {
        if (this.isResizingLensBox && this.initLensBox && this.dragStartPos) {
          const dx = pt.x - this.dragStartPos.x;
          const dy = pt.y - this.dragStartPos.y;
          const init = this.initLensBox;

          let newX = init.x;
          let newY = init.y;
          let newW = init.w;
          let newH = init.h;

          if (this.isResizingLensBox === 'br') {
            newW = Math.max(20, init.w + dx);
            newH = Math.max(20, init.h + dy);
          } else if (this.isResizingLensBox === 'tr') {
            newW = Math.max(20, init.w + dx);
            newH = Math.max(20, init.h - dy);
            newY = init.y + (init.h - newH);
          } else if (this.isResizingLensBox === 'bl') {
            newW = Math.max(20, init.w - dx);
            newH = Math.max(20, init.h + dy);
            newX = init.x + (init.w - newW);
          } else if (this.isResizingLensBox === 'tl') {
            newW = Math.max(20, init.w - dx);
            newH = Math.max(20, init.h - dy);
            newX = init.x + (init.w - newW);
            newY = init.y + (init.h - newH);
          }

          this.lensCropBox = { x: newX, y: newY, w: newW, h: newH };
          this.renderLensCropBox(view);
          return;
        }

        if (this.isDraggingLensBox && this.initLensBox && this.dragStartPos) {
          const dx = pt.x - this.dragStartPos.x;
          const dy = pt.y - this.dragStartPos.y;
          this.lensCropBox.x = this.initLensBox.x + dx;
          this.lensCropBox.y = this.initLensBox.y + dy;
          this.renderLensCropBox(view);
          return;
        }

        this.lensCropBox.w = pt.x - this.lensCropBox.x;
        this.lensCropBox.h = pt.y - this.lensCropBox.y;
        this.renderLensCropBox(view);
        return;
      }

      if (window.ToolState.currentTool === 'eraser') {
        this.eraseStrokesAndImagesAtPoint(view, pt);
        if (window.ToolState.eraserMode === 'pixel') {
          this.pixelErase(view, pt);
        }

        // Draw eraser cursor circle on ui canvas so user can see eraser boundary
        this.clearLayer(view.uiCtx, view);
        const ctx = view.uiCtx;
        const r = window.ToolState.eraserSize || 20;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.85)';
        ctx.lineWidth = 1.5 / this.zoom;
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        ctx.stroke();
        // Inner white ring for contrast on dark backgrounds
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 0.8 / this.zoom;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
        return;
      }


      this.currentPoints.push(pt);

      if (this.shapeHoldTimer) clearTimeout(this.shapeHoldTimer);

      const tool = window.ToolState.currentTool;
      if (tool === 'highlighter' || tool === 'pen' || tool === 'pencil' || tool === 'shape') {
        this.shapeHoldTimer = setTimeout(() => {
          if (this.isDrawing && this.currentPoints.length >= 2) {
            if (tool === 'highlighter' || tool === 'pen' || tool === 'pencil') {
              const startPt = this.currentPoints[0];
              const endPt = this.currentPoints[this.currentPoints.length - 1];
              this.heldShape = {
                type: 'line',
                x1: startPt.x, y1: startPt.y,
                x2: endPt.x, y2: endPt.y
              };
              this.renderShapePreview(view, this.heldShape);
            } else if (tool === 'shape') {
              const detected = window.detectShape(this.currentPoints);
              if (detected) {
                this.heldShape = detected;
                this.renderShapePreview(view, detected);
              }
            }
          }
        }, 300);
      }

      if (!this.heldShape) {
        this.renderLiveStroke(view);
      } else if (tool === 'highlighter' || tool === 'pen' || tool === 'pencil') {
        // Raw un-snapped line during first gesture!
        const startPt = this.currentPoints[0];
        this.heldShape = {
          type: 'line',
          x1: startPt.x, y1: startPt.y,
          x2: pt.x, y2: pt.y
        };
        this.renderShapePreview(view, this.heldShape);
      }



    }, { passive: false });




    target.addEventListener('pointerup', (e) => {
      const pt = this.getCanvasCoords(e, view);

      if (this.isAdjustingLineEndpoint) {
        if (e.cancelable) e.preventDefault();
        this.isAdjustingLineEndpoint = null;
        this.isDrawing = false;
        this.onPageModified(view.index);
        return;
      }

      if (this.isDraggingSelection || this.isResizingSelection || this.isRotatingSelection) {
        if (e.cancelable) e.preventDefault();

        // Finalize stroke points positions on pointerup
        if (this.initSelectionState && this.selectedStrokes) {
          if (this.isDraggingSelection && this.dragStartPos) {
            const dx = pt.x - this.dragStartPos.x;
            const dy = pt.y - this.dragStartPos.y;
            this.selectedStrokes.forEach((s, idx) => {
              const initPts = this.initSelectionState.strokes[idx];
              if (!initPts) return;
              s.points.forEach((p, pIdx) => {
                p.x = initPts[pIdx].x + dx;
                p.y = initPts[pIdx].y + dy;
              });
            });
          } else if (this.isResizingSelection) {
            const initBox = this.initSelectionState.box;
            const scale = this.selectionBox.w / (initBox.w || 1);
            const newX = this.selectionBox.x;
            const newY = this.selectionBox.y;
            this.selectedStrokes.forEach((s, idx) => {
              const initPts = this.initSelectionState.strokes[idx];
              if (!initPts) return;
              s.points.forEach((p, pIdx) => {
                const initPt = initPts[pIdx];
                p.x = newX + (initPt.x - initBox.x) * scale;
                p.y = newY + (initPt.y - initBox.y) * scale;
              });
            });
            this.selectedTextBoxes.forEach((tb, idx) => {
              const initTb = this.initSelectionState.textBoxes[idx];
              if (initTb) {
                tb.fontSize = Math.max(10, Math.round((initTb.fontSize || 18) * scale));
                tb.x = newX + (initTb.x - initBox.x) * scale;
                tb.y = newY + (initTb.y - initBox.y) * scale;
              }
            });
          } else if (this.isRotatingSelection) {
            const centerX = this.initSelectionState.box.x + this.initSelectionState.box.w / 2;
            const centerY = this.initSelectionState.box.y + this.initSelectionState.box.h / 2;
            const effectiveDeltaRad = (this.selectionAngle || 0) - (this.initSelectionState.angle || 0);
            const cos = Math.cos(effectiveDeltaRad);
            const sin = Math.sin(effectiveDeltaRad);
            this.selectedStrokes.forEach((s, idx) => {
              const initPts = this.initSelectionState.strokes[idx];
              if (!initPts) return;
              s.points.forEach((p, pIdx) => {
                const initPt = initPts[pIdx];
                const pdx = initPt.x - centerX;
                const pdy = initPt.y - centerY;
                p.x = centerX + pdx * cos - pdy * sin;
                p.y = centerY + pdx * sin + pdy * cos;
              });
            });
          }
        }

        this.isDraggingSelection = false;
        this.isResizingSelection = false;
        this.isRotatingSelection = false;
        this.isDrawing = false;
        this.initSelectionState = null;

        // Render everything cleanly to main layers
        this.renderPageStrokes(view);
        this.renderPageImages(view);
        this.renderPageTextOverlays(view);
        this.renderSelectionBoundingBox(view);
        this.onPageModified(view.index);
        return;
      }


      if (e.pointerType === 'touch' || window.ToolState.currentTool === 'text') return;
      if (this.isPinching) {
        this.isDrawing = false;
        this.currentPoints = [];
        this.clearLayer(view.activeCtx, view);
        return;
      }

      if (!this.isDrawing || this.activePageIndex !== view.index) return;
      this.isDrawing = false;

      if (this.shapeHoldTimer) clearTimeout(this.shapeHoldTimer);

      if (window.ToolState.currentTool === 'laser') {
        this.startLaserFadeOut(view);
        return;
      }

      if (window.ToolState.currentTool === 'lasso') {
        this.findStrokesInLasso(view);
        if (this.selectedStrokes.length > 0 || this.selectedImages.length > 0 || this.selectedTextBoxes.length > 0) {
          this.computeSelectionBoundingBox();
          this.renderSelectionBoundingBox(view);
        } else {
          this.selectionBox = null;
          this.clearLayer(view.uiCtx, view);
        }
        return;
      }

      if (window.ToolState.currentTool === 'lens') {
        if (this.lensCropBox) {
          let { x, y, w, h } = this.lensCropBox;
          if (w < 0) { x += w; w = Math.abs(w); }
          if (h < 0) { y += h; h = Math.abs(h); }
          this.lensCropBox = { x, y, w, h };
          if (w < 15 || h < 15) {
            this.lensCropBox = null;
            this.clearLayer(view.uiCtx, view);
          } else {
            this.renderLensCropBox(view);
          }
        }
        this.isDrawing = false;
        this.isResizingLensBox = null;
        this.isDraggingLensBox = false;
        this.initLensBox = null;
        return;
      }

      if (window.ToolState.currentTool === 'eraser') {
        this.clearLayer(view.uiCtx, view); // Clear eraser cursor circle
        this.onPageModified(view.index);
        this.restorePreviousToolIfEraser();
        return;
      }

      if (window.ToolState.currentTool === 'shape') {
        const detected = this.heldShape || window.detectShape(this.currentPoints);
        if (detected) {
          this.commitShape(view, detected);
          this.heldShape = null;
        }
        this.restorePreviousToolIfEraser();
        this.clearLayer(view.activeCtx, view);
        this.currentPoints = [];
        return;
      }

      if (this.heldShape) {
        this.commitShape(view, this.heldShape);
        this.heldShape = null;
      } else if (this.currentPoints.length > 1) {
        const smoothedPoints = window.catmullRomSpline(this.currentPoints);
        const newStroke = {
          id: 'stroke-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          tool: window.ToolState.currentTool,
          penStyle: window.ToolState.penStyle,
          color: window.ToolState.currentTool === 'highlighter' ? window.ToolState.highlighterColor : 
                 window.ToolState.currentTool === 'pencil' ? window.ToolState.pencilColor : window.ToolState.color,
          size: window.ToolState.currentTool === 'highlighter' ? window.ToolState.highlighterSize :
                window.ToolState.currentTool === 'pencil' ? window.ToolState.pencilSize : window.ToolState.size,
          points: smoothedPoints
        };

        if (!view.pageData.strokes) view.pageData.strokes = [];
        view.pageData.strokes.push(newStroke);
        this.drawSingleStroke(view.strokeCtx, newStroke);
        this.onPageModified(view.index);
      }

      this.restorePreviousToolIfEraser();

      this.clearLayer(view.activeCtx, view);
      this.currentPoints = [];
      // Pen lifted — clear any scroll state that may have accumulated via touchstart
      this._touchScrollStart = null;
      this.isDrawing = false;
    });

    target.addEventListener('pointercancel', (e) => {
      this.restorePreviousToolIfEraser();
      this.isDrawing = false;
      this._touchScrollStart = null;
      this.clearLayer(view.activeCtx, view);
      this.currentPoints = [];
    });

    target.addEventListener('pointerleave', (e) => {
      if (!this.isDrawing) {
        this.restorePreviousToolIfEraser();
      }
      // Always clear eraser cursor on leave
      if (window.ToolState.currentTool === 'eraser') {
        this.clearLayer(view.uiCtx, view);
      }
    });
  }



  hitTestSelectionHandles(pt) {
    if (this.activeLineEndpoints) {
      const lineRadius = 30; // Generous 30px touch area for line endpoint handles 🔵
      if (Math.hypot(pt.x - this.activeLineEndpoints.p1.x, pt.y - this.activeLineEndpoints.p1.y) <= lineRadius) {
        return 'line-p1';
      }
      if (Math.hypot(pt.x - this.activeLineEndpoints.p2.x, pt.y - this.activeLineEndpoints.p2.y) <= lineRadius) {
        return 'line-p2';
      }
    }

    if (!this.selectionBox) return null;

    const { x, y, w, h } = this.selectionBox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const angle = this.selectionAngle || 0;

    // Un-rotate click coordinates into local box space
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const localX = cx + dx * cos - dy * sin;
    const localY = cy + dx * sin + dy * cos;

    const radius = 18;

    // Crop Handle at Top Right (Orange Scissors ✂️) when exactly 1 image is selected
    if (this.selectedImages && this.selectedImages.length === 1 && (!this.selectedStrokes || !this.selectedStrokes.length) && (!this.selectedTextBoxes || !this.selectedTextBoxes.length)) {
      const cropX = x + w - 60;
      const cropY = y - 26;
      if (Math.hypot(localX - cropX, localY - cropY) <= radius + 6) {
        return 'crop';
      }
    }

    // Copy Handle at Top Right (Green Copy Icon 📋)
    const copyX = x + w - 30;
    const copyY = y - 26;
    if (Math.hypot(localX - copyX, localY - copyY) <= radius + 6) {
      return 'copy';
    }

    // Delete Handle at Top Right (Red Trash Can 🗑️)
    const delX = x + w;
    const delY = y - 26;
    if (Math.hypot(localX - delX, localY - delY) <= radius + 6) {
      return 'delete';
    }

    // Rotation Handle at top center
    const rotX = x + w / 2;
    const rotY = y - 26;
    if (Math.hypot(localX - rotX, localY - rotY) <= radius) {
      return 'rotate';
    }


    const corners = [
      { id: 'tl', cx: x, cy: y },
      { id: 'tr', cx: x + w, cy: y },
      { id: 'br', cx: x + w, cy: y + h },
      { id: 'bl', cx: x, cy: y + h }
    ];

    for (const c of corners) {
      if (Math.hypot(localX - c.cx, localY - c.cy) <= radius) {
        return c.id;
      }
    }
    return null;
  }



  snapshotInitSelectionState() {
    if (!this.selectionBox) return;

    this.initSelectionState = {
      box: { ...this.selectionBox },
      angle: this.selectionAngle || 0,
      strokes: this.selectedStrokes.map(s => s.points.map(p => ({ ...p }))),
      images: this.selectedImages.map(img => ({ ...img })),
      textBoxes: this.selectedTextBoxes.map(tb => ({ ...tb }))
    };

    const view = this.pageViews[this.activePageIndex];
    if (view) {
      this.renderUnselectedPageStrokes(view);
    }
  }

  renderUnselectedPageStrokes(view) {
    this.clearLayer(view.strokeCtx, view);
    if (!view.pageData || !view.pageData.strokes) return;
    const selectedSet = new Set(this.selectedStrokes);
    view.pageData.strokes.forEach(s => {
      if (!selectedSet.has(s)) {
        this.drawSingleStroke(view.strokeCtx, s);
      }
    });
  }

  renderSelectionDragPreview(view, dx = 0, dy = 0, scale = 1, angleRad = 0, cx = 0, cy = 0) {
    this.clearLayer(view.uiCtx, view);
    if (!this.selectionBox) return;

    const ctx = view.uiCtx;
    ctx.save();

    if (this.selectedStrokes && this.selectedStrokes.length > 0 && this.initSelectionState) {
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const initBox = this.initSelectionState.box;

      this.selectedStrokes.forEach((s, sIdx) => {
        const initPts = this.initSelectionState.strokes[sIdx];
        if (!initPts || initPts.length < 2) return;

        const tempPts = initPts.map(pt => {
          let x = pt.x;
          let y = pt.y;
          if (scale !== 1) {
            x = initBox.x + (pt.x - initBox.x) * scale + (this.selectionBox.x - initBox.x);
            y = initBox.y + (pt.y - initBox.y) * scale + (this.selectionBox.y - initBox.y);
          } else if (angleRad !== 0) {
            const px = pt.x - cx;
            const py = pt.y - cy;
            x = cx + px * cos - py * sin;
            y = cy + px * sin + py * cos;
          } else {
            x = pt.x + dx;
            y = pt.y + dy;
          }
          return { ...pt, x, y };
        });

        const tempStroke = { ...s, points: tempPts };
        this.drawSingleStroke(ctx, tempStroke);
      });
    }

    ctx.restore();
    this.renderSelectionBoundingBox(view, true);
  }

  applySelectionResize(dx, dy, view) {
    if (!this.initSelectionState || !this.selectionBox) return;

    const initBox = this.initSelectionState.box;
    const aspectRatio = initBox.w / (initBox.h || 1);

    let newW = initBox.w;
    let newH = initBox.h;

    if (this.resizeHandle === 'br' || this.resizeHandle === 'tr') {
      newW = Math.max(40, initBox.w + dx);
      newH = newW / aspectRatio;
    } else if (this.resizeHandle === 'bl' || this.resizeHandle === 'tl') {
      newW = Math.max(40, initBox.w - dx);
      newH = newW / aspectRatio;
    }

    let newX = initBox.x;
    let newY = initBox.y;

    if (this.resizeHandle === 'tl' || this.resizeHandle === 'bl') {
      newX = initBox.x + (initBox.w - newW);
    }
    if (this.resizeHandle === 'tl' || this.resizeHandle === 'tr') {
      newY = initBox.y + (initBox.h - newH);
    }

    const scale = newW / (initBox.w || 1);

    this.selectedImages.forEach((img, idx) => {
      const initImg = this.initSelectionState.images[idx];
      img.w = Math.max(20, initImg.w * scale);
      img.h = Math.max(20, initImg.h * scale);
      img.x = newX + (initImg.x - initBox.x) * scale;
      img.y = newY + (initImg.y - initBox.y) * scale;
      if (img._el) {
        img._el.style.left = `${img.x}px`;
        img._el.style.top = `${img.y}px`;
        img._el.style.width = `${img.w}px`;
        img._el.style.height = `${img.h}px`;
      }
    });

    this.selectedTextBoxes.forEach((tb, idx) => {
      const initTb = this.initSelectionState.textBoxes[idx];
      const scaledSize = Math.max(10, Math.round((initTb.fontSize || 18) * scale));
      tb.fontSize = scaledSize;
      tb.x = newX + (initTb.x - initBox.x) * scale;
      tb.y = newY + (initTb.y - initBox.y) * scale;
      if (tb._el) {
        tb._el.style.left = `${tb.x}px`;
        tb._el.style.top = `${tb.y}px`;
        tb._el.style.fontSize = `${scaledSize}px`;
      }
    });

    this.selectionBox.x = newX;
    this.selectionBox.y = newY;
    this.selectionBox.w = newW;
    this.selectionBox.h = newH;

    this.renderSelectionDragPreview(view, 0, 0, scale);
  }

  applySelectionRotate(angleRad, centerX, centerY, view) {
    if (!this.initSelectionState) return;

    let rawTotalRad = (this.initSelectionState.angle || 0) + angleRad;
    let deg = (rawTotalRad * 180 / Math.PI) % 360;
    if (deg < 0) deg += 360;

    const snapTargets = [0, 45, 90, 135, 180, 225, 270, 315, 360];
    const snapThreshold = 8;

    let finalTotalRad = rawTotalRad;
    for (let target of snapTargets) {
      if (Math.abs(deg - target) <= snapThreshold) {
        const snappedDeg = (target === 360) ? 0 : target;
        const diffDeg = snappedDeg - deg;
        finalTotalRad = rawTotalRad + (diffDeg * Math.PI / 180);
        break;
      }
    }

    const effectiveDeltaRad = finalTotalRad - (this.initSelectionState.angle || 0);
    const cos = Math.cos(effectiveDeltaRad);
    const sin = Math.sin(effectiveDeltaRad);

    const rotatePoint = (p) => {
      const dx = p.x - centerX;
      const dy = p.y - centerY;
      return {
        x: centerX + dx * cos - dy * sin,
        y: centerY + dx * sin + dy * cos
      };
    };

    this.selectedImages.forEach((img, idx) => {
      const initImg = this.initSelectionState.images[idx];
      const imgCenterX = initImg.x + (initImg.w || 100) / 2;
      const imgCenterY = initImg.y + (initImg.h || 100) / 2;
      const rotatedCenter = rotatePoint({ x: imgCenterX, y: imgCenterY });
      img.x = rotatedCenter.x - (img.w || 100) / 2;
      img.y = rotatedCenter.y - (img.h || 100) / 2;
      img.rotation = (initImg.rotation || 0) + (effectiveDeltaRad * 180 / Math.PI);
      if (img._el) {
        img._el.style.left = `${img.x}px`;
        img._el.style.top = `${img.y}px`;
        img._el.style.transform = `rotate(${img.rotation}deg)`;
      }
    });

    this.selectedTextBoxes.forEach((tb, idx) => {
      const initTb = this.initSelectionState.textBoxes[idx];
      const rotated = rotatePoint({ x: initTb.x, y: initTb.y });
      tb.x = rotated.x;
      tb.y = rotated.y;
      if (tb._el) {
        tb._el.style.left = `${tb.x}px`;
        tb._el.style.top = `${tb.y}px`;
      }
    });

    this.selectionAngle = finalTotalRad;

    this.renderSelectionDragPreview(view, 0, 0, 1, effectiveDeltaRad, centerX, centerY);
  }




  bindViewportScroll() {
    this.viewport.addEventListener('scroll', () => {
      this.updateActivePageOnScroll();
    });

    this.viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.08 : 0.92;
        this.zoomAtPoint(this.zoom * factor, e.clientX, e.clientY);
      }
    }, { passive: false });

    // Viewport-Level Pinch Zoom & Pan Handler (Prevents browser whole-page zoom)
    this.viewport.addEventListener('touchstart', (e) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        this.isPinching = true;
        this.isDrawing = false;
        this.currentPoints = [];

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        this.initialPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        this.initialZoom = this.zoom;

        this.lastMidX = (t1.clientX + t2.clientX) / 2;
        this.lastMidY = (t1.clientY + t2.clientY) / 2;
      }
    }, { passive: false });

    this.viewport.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) {
        if (e.cancelable) e.preventDefault();
        this.isPinching = true;
        this.isDrawing = false;
        this.currentPoints = [];

        const t1 = e.touches[0];
        const t2 = e.touches[1];

        const currentMidX = (t1.clientX + t2.clientX) / 2;
        const currentMidY = (t1.clientY + t2.clientY) / 2;
        const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

        if (this.initialPinchDist > 0) {
          const scale = currentDist / this.initialPinchDist;
          const newZoom = this.initialZoom * scale;
          this.pinchZoomAndPan(newZoom, currentMidX, currentMidY, this.lastMidX, this.lastMidY);

          this.lastMidX = currentMidX;
          this.lastMidY = currentMidY;
        }
      }
    }, { passive: false });

    this.viewport.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        // Small delay so last-finger pointerdown isn't blocked by isPinching still true
        setTimeout(() => {
          this.isPinching = false;
          this.initialPinchDist = 0;
          this.lastMidX = undefined;
          this.lastMidY = undefined;
        }, 60);
      }
    });

    this.viewport.addEventListener('touchcancel', () => {
      this.isPinching = false;
      this.initialPinchDist = 0;
      this.lastMidX = undefined;
      this.lastMidY = undefined;
    });

    // Keyboard shortcuts for Lasso Delete & Copy/Paste
    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement.isContentEditable) return;

      const view = this.pageViews[this.activePageIndex];
      if (!view) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectionBox) {
          e.preventDefault();
          this.deleteSelectedObjects(view);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'v' || e.key === 'V' || e.key === 'd' || e.key === 'D')) {
        if (this.selectionBox) {
          e.preventDefault();
          this.copySelectedObjects(view);
        }
      }
    });

    // Prevent browser native Safari/Chromium gesture zoom on page toolbar
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
  }




  updateActivePageOnScroll() {
    if (this.pageViews.length === 0) return;
    const viewportRect = this.viewport.getBoundingClientRect();
    const viewportCenter = viewportRect.top + viewportRect.height / 2;

    let closestIndex = 0;
    let minDistance = Infinity;

    this.pageViews.forEach((view, idx) => {
      const pageRect = view.container.getBoundingClientRect();
      const pageCenter = pageRect.top + pageRect.height / 2;
      const dist = Math.abs(viewportCenter - pageCenter);
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = idx;
      }
    });

    if (closestIndex !== this.activePageIndex) {
      this.activePageIndex = closestIndex;
      this.onActivePageChanged(closestIndex);
    }
  }

  async scrollToPage(index) {
    if (index >= 0 && index < this.pageViews.length) {
      const targetView = this.pageViews[index];
      if (targetView) {
        if (!targetView.canvasReady && !targetView.canvasLoading) {
          await this._initPageCanvases(targetView);
        }
        targetView.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.activePageIndex = index;
        this.onActivePageChanged(index);
      }
    }
  }

  clearLayer(ctx, view) {
    ctx.clearRect(0, 0, view.width, view.height);
  }

  renderLiveStroke(view) {
    this.clearLayer(view.activeCtx, view);
    if (this.currentPoints.length < 2) return;

    const stroke = {
      tool: window.ToolState.currentTool,
      penStyle: window.ToolState.penStyle,
      color: window.ToolState.currentTool === 'highlighter' ? window.ToolState.highlighterColor :
             window.ToolState.currentTool === 'pencil' ? window.ToolState.pencilColor : window.ToolState.color,
      size: window.ToolState.currentTool === 'highlighter' ? window.ToolState.highlighterSize :
            window.ToolState.currentTool === 'pencil' ? window.ToolState.pencilSize : window.ToolState.size,
      points: this.currentPoints
    };

    this.drawSingleStroke(view.activeCtx, stroke);
  }

  drawSingleStroke(ctx, stroke) {
    const { points, tool, penStyle, color, size } = stroke;
    if (!points || points.length === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, Math.max(0.5, size / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = color;
      ctx.lineWidth   = size;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();

    } else if (tool === 'pencil') {
      ctx.strokeStyle = color;
      ctx.lineWidth   = size;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();

    } else {
      ctx.strokeStyle = color;

      if (penStyle === 'ballpoint' || points.length < 3) {
        ctx.lineWidth = size;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          const xc = (points[i].x + points[i + 1].x) / 2;
          const yc = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
      } else {
        // Continuous Midpoint Bézier Spline for Fountain & Brush Pen with dynamic pressure tapering
        let midX = (points[0].x + points[1].x) / 2;
        let midY = (points[0].y + points[1].y) / 2;

        // First initial segment from p0 to mid0
        const initPr = (points[0].pressure && !isNaN(points[0].pressure) && points[0].pressure > 0) ? points[0].pressure : 0.5;
        const initW = Math.max(1, size * (penStyle === 'brush' ? (0.3 + initPr * 1.3) : (0.5 + initPr * 0.8)));
        ctx.lineWidth = initW;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(midX, midY);
        ctx.stroke();

        for (let i = 1; i < points.length - 1; i++) {
          const pCurrent = points[i];
          const pNext = points[i + 1];
          const nextMidX = (pCurrent.x + pNext.x) / 2;
          const nextMidY = (pCurrent.y + pNext.y) / 2;

          const pr = (pCurrent.pressure !== undefined && !isNaN(pCurrent.pressure) && pCurrent.pressure > 0)
            ? pCurrent.pressure
            : 0.5;
          const pressureFactor = penStyle === 'brush'
            ? (0.3 + pr * 1.3)
            : (0.5 + pr * 0.8);
          const segWidth = Math.max(1, size * pressureFactor);

          ctx.lineWidth = segWidth;
          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.quadraticCurveTo(pCurrent.x, pCurrent.y, nextMidX, nextMidY);
          ctx.stroke();

          midX = nextMidX;
          midY = nextMidY;
        }

        // Final segment to last point
        const lastPt = points[points.length - 1];
        const lastPr = (lastPt.pressure && !isNaN(lastPt.pressure) && lastPt.pressure > 0) ? lastPt.pressure : 0.5;
        const lastW = Math.max(1, size * (penStyle === 'brush' ? (0.3 + lastPr * 1.3) : (0.5 + lastPr * 0.8)));
        ctx.lineWidth = lastW;
        ctx.beginPath();
        ctx.moveTo(midX, midY);
        ctx.lineTo(lastPt.x, lastPt.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  renderPageStrokes(view) {
    this.clearLayer(view.strokeCtx, view);
    if (!view.pageData || !view.pageData.strokes) return;
    view.pageData.strokes.forEach(s => this.drawSingleStroke(view.strokeCtx, s));
  }

  pixelErase(view, pt) {
    const ctx = view.strokeCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, window.ToolState.eraserSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  eraseStrokesAndImagesAtPoint(view, pt) {
    if (!view.pageData) return;
    const radius = window.ToolState.eraserSize || 20;
    let modified = false;

    if (view.pageData.strokes && view.pageData.strokes.length > 0) {
      const initialCount = view.pageData.strokes.length;
      view.pageData.strokes = view.pageData.strokes.filter(s => {
        const hit = s.points.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) < radius);
        return !hit;
      });
      if (view.pageData.strokes.length !== initialCount) {
        this.renderPageStrokes(view);
        modified = true;
      }
    }

    if (view.pageData.images && view.pageData.images.length > 0) {
      const initialImgCount = view.pageData.images.length;
      view.pageData.images = view.pageData.images.filter(img => {
        const hit = (pt.x >= img.x - radius && pt.x <= img.x + img.w + radius && 
                     pt.y >= img.y - radius && pt.y <= img.y + img.h + radius);
        return !hit;
      });
      if (view.pageData.images.length !== initialImgCount) {
        this.renderPageImages(view);
        modified = true;
      }
    }

    if (view.pageData.textBoxes && view.pageData.textBoxes.length > 0) {
      const initialBoxCount = view.pageData.textBoxes.length;
      view.pageData.textBoxes = view.pageData.textBoxes.filter(tb => {
        if (tb.state === 'editing') return true; // Don't erase text box while user is typing inside

        const w = tb._el ? (tb._el.offsetWidth || 100) : Math.max(80, (tb.text || '').length * ((tb.fontSize || 18) * 0.6));
        const h = tb._el ? (tb._el.offsetHeight || 40) : Math.max(30, (tb.fontSize || 18) * 1.5);
        
        const hit = (pt.x >= tb.x - radius && pt.x <= tb.x + w + radius && 
                     pt.y >= tb.y - radius && pt.y <= tb.y + h + radius);
        return !hit;
      });
      if (view.pageData.textBoxes.length !== initialBoxCount) {
        this.renderPageTextOverlays(view);
        modified = true;
      }
    }

    if (modified) {
      this.onPageModified(view.index);
    }
  }

  renderLassoFreehandPath(view) {
    this.clearLayer(view.uiCtx, view);
    if (this.lassoPolygon.length < 2) return;

    const ctx = view.uiCtx;
    ctx.save();
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(this.lassoPolygon[0].x, this.lassoPolygon[0].y);
    for (let i = 1; i < this.lassoPolygon.length; i++) {
      ctx.lineTo(this.lassoPolygon[i].x, this.lassoPolygon[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  findStrokesInLasso(view) {
    if (!view.pageData || this.lassoPolygon.length < 3) return;

    // Fast Bounding Box calculation for Lasso polygon (AABB)
    let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity;
    for (let i = 0; i < this.lassoPolygon.length; i++) {
      const p = this.lassoPolygon[i];
      if (p.x < lMinX) lMinX = p.x;
      if (p.x > lMaxX) lMaxX = p.x;
      if (p.y < lMinY) lMinY = p.y;
      if (p.y > lMaxY) lMaxY = p.y;
    }

    // Subsample polygon if points > 80 for instant collision check
    let poly = this.lassoPolygon;
    if (poly.length > 80) {
      const step = Math.ceil(poly.length / 80);
      const sampled = [];
      for (let i = 0; i < poly.length; i += step) {
        sampled.push(poly[i]);
      }
      sampled.push(poly[poly.length - 1]);
      poly = sampled;
    }

    // 1. Select Strokes inside Lasso
    if (view.pageData.strokes) {
      this.selectedStrokes = view.pageData.strokes.filter(s => {
        if (!s.points || s.points.length === 0) return false;
        let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
        for (let j = 0; j < s.points.length; j++) {
          const pt = s.points[j];
          if (pt.x < sMinX) sMinX = pt.x;
          if (pt.x > sMaxX) sMaxX = pt.x;
          if (pt.y < sMinY) sMinY = pt.y;
          if (pt.y > sMaxY) sMaxY = pt.y;
        }
        // AABB Rejection (with 5px safety padding)
        if (sMaxX < lMinX - 5 || sMinX > lMaxX + 5 || sMaxY < lMinY - 5 || sMinY > lMaxY + 5) {
          return false;
        }
        // Point-in-polygon test: check every 1-3 points (never skip stroke segments!)
        const step = Math.max(1, Math.min(3, Math.floor(s.points.length / 80)));
        for (let j = 0; j < s.points.length; j += step) {
          if (window.isPointInPolygon(s.points[j], poly)) return true;
        }
        return false;
      });
    } else {
      this.selectedStrokes = [];
    }

    // 2. Select Images inside Lasso
    if (view.pageData.images) {
      this.selectedImages = view.pageData.images.filter(img => {
        const center = { x: img.x + img.w / 2, y: img.y + img.h / 2 };
        return (center.x >= lMinX && center.x <= lMaxX && center.y >= lMinY && center.y <= lMaxY) &&
               window.isPointInPolygon(center, poly);
      });
    } else {
      this.selectedImages = [];
    }

    // 3. Select Text Boxes inside Lasso
    if (view.pageData.textBoxes) {
      this.selectedTextBoxes = view.pageData.textBoxes.filter(tb => {
        const center = { x: tb.x + 40, y: tb.y + 15 };
        return (center.x >= lMinX && center.x <= lMaxX && center.y >= lMinY && center.y <= lMaxY) &&
               window.isPointInPolygon(center, poly);
      });
    } else {
      this.selectedTextBoxes = [];
    }
  }

  clearSelection() {
    const view = this.pageViews ? this.pageViews[this.activePageIndex] : null;
    this.selectedStrokes = [];
    this.selectedImages = [];
    this.selectedTextBoxes = [];
    this.selectionBox = null;
    this.lensCropBox = null;
    this.lassoPolygon = [];
    if (view) {
      this.clearLayer(view.uiCtx, view);
      this.renderPageStrokes(view);
    }
  }

  computeSelectionBoundingBox() {
    if (this.selectedStrokes.length === 0 && 
        this.selectedImages.length === 0 && 
        this.selectedTextBoxes.length === 0) {
      this.selectionBox = null;
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    this.selectedStrokes.forEach(s => {
      s.points.forEach(p => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
    });

    this.selectedImages.forEach(img => {
      minX = Math.min(minX, img.x);
      maxX = Math.max(maxX, img.x + img.w);
      minY = Math.min(minY, img.y);
      maxY = Math.max(maxY, img.y + img.h);
    });

    this.selectedTextBoxes.forEach(tb => {
      let boxW = 120;
      let boxH = Math.round((tb.fontSize || 18) * 1.4);
      if (tb._el) {
        boxW = Math.max(50, tb._el.offsetWidth);
        boxH = Math.max(24, tb._el.offsetHeight);
      } else {
        const charWidth = (tb.fontSize || 18) * 0.6;
        boxW = Math.max(80, (tb.text || '').length * charWidth + 16);
      }
      minX = Math.min(minX, tb.x);
      maxX = Math.max(maxX, tb.x + boxW);
      minY = Math.min(minY, tb.y);
      maxY = Math.max(maxY, tb.y + boxH);
    });

    const padding = 12;
    this.selectionBox = {
      x: minX - padding,
      y: minY - padding,
      w: (maxX - minX) + padding * 2,
      h: (maxY - minY) + padding * 2
    };
    this.selectionAngle = 0;
  }


  renderSelectionBoundingBox(view, skipClear = false) {
    if (!skipClear) this.clearLayer(view.uiCtx, view);
    if (!this.selectionBox) return;

    const ctx = view.uiCtx;
    const { x, y, w, h } = this.selectionBox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const angle = this.selectionAngle || 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    const lx = -w / 2;
    const ly = -h / 2;

    // 1. Light blue highlight background
    ctx.fillStyle = 'rgba(0, 122, 255, 0.06)';
    ctx.fillRect(lx, ly, w, h);

    // 2. Dashed rotated border
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(lx, ly, w, h);

    // 3. Stem line connecting top-center to rotation handle
    const rotX = 0;
    const rotY = ly - 26;

    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(rotX, rotY);
    ctx.stroke();

    // 4. Four Corner Handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 2;

    const handleRadius = 5;
    const corners = [
      { cx: lx, cy: ly },
      { cx: lx + w, cy: ly },
      { cx: lx + w, cy: ly + h },
      { cx: lx, cy: ly + h }
    ];

    corners.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // 5. Rotation Handle Circle with Rotation Arrow Icon 🔄
    const rotRadius = 11;
    ctx.beginPath();
    ctx.arc(rotX, rotY, rotRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#007AFF';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Curved rotation arrow path
    ctx.beginPath();
    ctx.arc(rotX, rotY, 5.5, -Math.PI * 0.75, Math.PI * 0.75, false);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Arrow tip on arc end
    const tipAngle = -Math.PI * 0.75;
    const tx = rotX + Math.cos(tipAngle) * 5.5;
    const ty = rotY + Math.sin(tipAngle) * 5.5;
    ctx.beginPath();
    ctx.moveTo(tx - 3, ty + 2);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + 2, ty - 3);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 5.5 Crop Button Handle (Orange Circle with Scissors Icon ✂️)
    if (this.selectedImages && this.selectedImages.length === 1 && (!this.selectedStrokes || !this.selectedStrokes.length) && (!this.selectedTextBoxes || !this.selectedTextBoxes.length)) {
      const cropX = lx + w - 60;
      const cropY = ly - 26;
      ctx.beginPath();
      ctx.arc(cropX, cropY, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#FF9500';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Scissors Icon ✂️
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cropX - 3, cropY + 3, 2.5, 0, Math.PI * 2);
      ctx.arc(cropX + 3, cropY + 3, 2.5, 0, Math.PI * 2);
      ctx.moveTo(cropX - 2, cropY + 1); ctx.lineTo(cropX + 3, cropY - 4);
      ctx.moveTo(cropX + 2, cropY + 1); ctx.lineTo(cropX - 3, cropY - 4);
      ctx.stroke();
    }

    // 6. Copy / Duplicate Button Handle (Green Circle with Copy Icon 📋)
    const copyX = lx + w - 30;
    const copyY = ly - 26;
    ctx.beginPath();
    ctx.arc(copyX, copyY, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#34C759';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Copy Icon 📋
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(copyX - 4, copyY - 2, 6, 7);
    ctx.strokeRect(copyX - 1, copyY - 5, 6, 7);

    // 7. Delete Button Handle (Red Circle with Trash Can Icon 🗑️)

    const delX = lx + w;
    const delY = ly - 26;
    ctx.beginPath();
    ctx.arc(delX, delY, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#FF3B30';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Trash Can Icon
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(delX - 4, delY - 3); ctx.lineTo(delX + 4, delY - 3);
    ctx.moveTo(delX - 2, delY - 3); ctx.lineTo(delX - 2, delY - 5); ctx.lineTo(delX + 2, delY - 5); ctx.lineTo(delX + 2, delY - 3);
    ctx.moveTo(delX - 3.5, delY - 1); ctx.lineTo(delX - 2.5, delY + 4); ctx.lineTo(delX + 2.5, delY + 4); ctx.lineTo(delX + 3.5, delY - 1);
    ctx.moveTo(delX - 1, delY + 1); ctx.lineTo(delX - 1, delY + 3);
    ctx.moveTo(delX + 1, delY + 1); ctx.lineTo(delX + 1, delY + 3);
    ctx.stroke();

    ctx.restore();
  }

  copySelectedObjects(view) {
    if (!this.selectionBox || !view || !view.pageData) return;

    this.onBeforePageModified(view.index);

    const newStrokes = [];
    const newImages = [];
    const newTextBoxes = [];
    const offset = 24;

    if (this.selectedStrokes && this.selectedStrokes.length > 0) {
      this.selectedStrokes.forEach(s => {
        const cloned = JSON.parse(JSON.stringify(s));
        cloned.id = 'stroke-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        cloned.points.forEach(p => {
          p.x += offset;
          p.y += offset;
        });
        if (!view.pageData.strokes) view.pageData.strokes = [];
        view.pageData.strokes.push(cloned);
        newStrokes.push(cloned);
      });
    }

    if (this.selectedImages && this.selectedImages.length > 0) {
      this.selectedImages.forEach(img => {
        const cloned = JSON.parse(JSON.stringify(img));
        cloned.id = 'img-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        cloned.x += offset;
        cloned.y += offset;
        if (!view.pageData.images) view.pageData.images = [];
        view.pageData.images.push(cloned);
        newImages.push(cloned);
      });
    }

    if (this.selectedTextBoxes && this.selectedTextBoxes.length > 0) {
      this.selectedTextBoxes.forEach(tb => {
        const cloned = JSON.parse(JSON.stringify(tb));
        cloned.id = 'text-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        cloned.x += offset;
        cloned.y += offset;
        cloned.state = 'selected';
        if (!view.pageData.textBoxes) view.pageData.textBoxes = [];
        view.pageData.textBoxes.push(cloned);
        newTextBoxes.push(cloned);
      });
    }

    this.selectedStrokes = newStrokes;
    this.selectedImages = newImages;
    this.selectedTextBoxes = newTextBoxes;

    this.computeSelectionBoundingBox();
    this.renderPageStrokes(view);
    this.renderPageImages(view);
    this.renderPageTextOverlays(view);
    this.renderSelectionBoundingBox(view);
    this.onPageModified(view.index);
  }


  renderLensCropBox(view) {
    this.clearLayer(view.uiCtx, view);
    if (!this.lensCropBox) return;

    const ctx = view.uiCtx;
    let { x, y, w, h } = this.lensCropBox;

    const realX = w < 0 ? x + w : x;
    const realY = h < 0 ? y + h : y;
    const realW = Math.abs(w);
    const realH = Math.abs(h);

    if (realW < 2 || realH < 2) return;

    ctx.save();

    // 1. Light dim overlay around crop area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, view.width, view.height);

    // Clear inside crop box so page content is sharp and clear
    ctx.clearRect(realX, realY, realW, realH);

    // Redraw strokes and images inside the clear region with exact DPR scaling
    const dpr = view.dpr || 1;
    if (view.bgCanvas) {
      ctx.drawImage(
        view.bgCanvas,
        Math.round(realX * dpr), Math.round(realY * dpr),
        Math.round(realW * dpr), Math.round(realH * dpr),
        realX, realY, realW, realH
      );
    }
    if (view.strokeCanvas) {
      ctx.drawImage(
        view.strokeCanvas,
        Math.round(realX * dpr), Math.round(realY * dpr),
        Math.round(realW * dpr), Math.round(realH * dpr),
        realX, realY, realW, realH
      );
    }

    // 2. White outer border & Google Blue dashed crop border
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(realX, realY, realW, realH);

    ctx.strokeStyle = '#1A73E8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(realX - 1, realY - 1, realW + 2, realH + 2);
    ctx.setLineDash([]);

    // 3. Four White Handles with Blue border at 4 corners
    const handleRadius = 5;
    const corners = [
      { cx: realX, cy: realY },
      { cx: realX + realW, cy: realY },
      { cx: realX + realW, cy: realY + realH },
      { cx: realX, cy: realY + realH }
    ];

    corners.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.cx, c.cy, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#1A73E8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // 4. Center Rounded Pill Button: "📷 ค้นหาด้วย Google Lens" (as requested in user's design photo!)
    if (realW >= 50 && realH >= 30) {
      const btnW = Math.min(realW - 16, 210);
      const btnH = 36;
      const btnX = realX + (realW - btnW) / 2;
      const btnY = realY + (realH - btnH) / 2;

      // Soft shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;

      // Pill shape fill (Light Blue background like Google UI)
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(btnX, btnY, btnW, btnH, 18);
      } else {
        ctx.rect(btnX, btnY, btnW, btnH);
      }
      ctx.fillStyle = '#D2E3FC'; // Google Lens light blue pill background
      ctx.fill();

      ctx.shadowColor = 'transparent';

      // Border
      ctx.strokeStyle = '#185ABC';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Icon & Text
      ctx.fillStyle = '#174EA6';
      ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📷  ค้นหาด้วย Google Lens', btnX + btnW / 2, btnY + btnH / 2 + 1);
    }

    ctx.restore();
  }


  // ── Google Lens Search ──────────────────────────────────────────────────────
  // Captures the crop area, copies to clipboard, opens a new tab,
  // and auto-submits a multipart form POST to https://www.google.com/searchbyimage/upload
  // which redirects straight to Google Visual Search / Lens results without 403 errors.
  async searchWithGoogleLens(view) {
    const box = this.lensCropBox || this.selectionBox;
    if (!box || !view) return;

    let { x, y, w, h } = box;
    if (w < 0) { x += w; w = Math.abs(w); }
    if (h < 0) { y += h; h = Math.abs(h); }
    if (w < 5 || h < 5) return;

    const dpr = view.dpr || 1;

    // Composite all visible canvas layers into a temporary canvas
    const tmp = document.createElement('canvas');
    tmp.width  = Math.max(1, Math.round(w * dpr));
    tmp.height = Math.max(1, Math.round(h * dpr));
    const ctx = tmp.getContext('2d');
    ctx.scale(dpr, dpr);

    for (const cvs of [view.bgCanvas, view.strokeCanvas, view.activeCanvas]) {
      if (!cvs) continue;
      ctx.drawImage(cvs,
        Math.round(x * dpr), Math.round(y * dpr),
        Math.round(w * dpr), Math.round(h * dpr),
        0, 0, w, h
      );
    }

    tmp.toBlob((blob) => {
      if (!blob) return;

      // Open in a new tab (_blank)
      const lensWindow = window.open('', '_blank');

      if (!lensWindow) {
        alert('กรุณาอนุญาต Pop-up หรือแท็บใหม่ในเบราว์เซอร์เพื่อแสดงผล Google Lens');
        return;
      }

      // 3. Submit cropped image form POST directly to Google Lens!
      lensWindow.document.open();
      lensWindow.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>Google Lens — ผลการค้นหาภาพถ่าย</title>
  <style>
    body { margin: 0; display: flex; flex-direction: column; align-items: center;
           justify-content: center; height: 100vh; font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
           background: #202124; color: #e8eaed; }
    .logo { font-size: 28px; font-weight: 700; margin-bottom: 12px; }
    .logo .g { color: #4285f4; }
    .logo .o1 { color: #ea4335; }
    .logo .o2 { color: #fbbc05; }
    .logo .g2 { color: #4285f4; }
    .logo .l { color: #34a853; }
    .logo .e { color: #ea4335; }
    p { font-size: 14px; color: #9aa0a6; margin-top: 8px; }
    .spinner { width: 34px; height: 34px; border: 3px solid #3c4043;
               border-top-color: #8ab4f8; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 12px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="logo">
    <span class="g">G</span><span class="o1">o</span><span class="o2">o</span><span class="g2">g</span><span class="l">l</span><span class="e">e</span> Lens
  </div>
  <div class="spinner"></div>
  <p>กำลังค้นหาภาพถ่ายด้วย Google Lens…</p>
  <form id="lens-form" method="POST"
        action="https://www.google.com/searchbyimage/upload"
        enctype="multipart/form-data" style="display:none">
    <input type="file" id="lens-file" name="encoded_image" accept="image/*">
  </form>
  <script>
    window.addEventListener('message', function(e) {
      if (!e.data || e.data.type !== 'lens-image') return;
      try {
        var blob = new Blob([e.data.buffer], { type: 'image/png' });
        var file = new File([blob], 'selection.png', { type: 'image/png' });
        var dt   = new DataTransfer();
        dt.items.add(file);
        document.getElementById('lens-file').files = dt.files;
        document.getElementById('lens-form').submit();
      } catch(err) {
        document.querySelector('p').textContent = 'เกิดข้อผิดพลาด: ' + err.message;
      }
    });
  </script>
</body>
</html>`);
      lensWindow.document.close();

      // 4. Send image buffer to popup window
      blob.arrayBuffer().then((buffer) => {
        const send = () => {
          try {
            lensWindow.postMessage({ type: 'lens-image', buffer }, '*');
          } catch (err) {}
        };
        setTimeout(send, 100);
      });

      // Clear crop box overlay on canvas
      this.lensCropBox = null;
      this.clearLayer(view.uiCtx, view);
    }, 'image/png');
  }




  renderLineEndpoints(view) {
    if (!this.activeLineEndpoints || !this.activeLineStroke) return;

    this.clearLayer(view.uiCtx, view);
    const ctx = view.uiCtx;
    const { p1, p2 } = this.activeLineEndpoints;

    ctx.save();

    // Render ONLY 2 interactive endpoint handles 🔵 (No dashed line)
    [p1, p2].forEach(p => {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#007AFF';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    });

    ctx.restore();
  }





  renderLaserLine(view) {
    this.clearLayer(view.uiCtx, view);
    if (this.laserPoints.length < 2) return;

    const ctx = view.uiCtx;
    ctx.save();

    ctx.strokeStyle = `rgba(255, 45, 85, ${0.9 * this.laserAlpha})`;
    ctx.shadowColor = '#FF2D55';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.laserPoints[0].x, this.laserPoints[0].y);
    for (let i = 1; i < this.laserPoints.length; i++) {
      ctx.lineTo(this.laserPoints[i].x, this.laserPoints[i].y);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * this.laserAlpha})`;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  startLaserFadeOut(view) {
    this.laserState = 'fading';
    let fadeDelay = 250;

    const fadeStep = () => {
      if (fadeDelay > 0) {
        fadeDelay -= 16;
        this.laserAnimId = requestAnimationFrame(fadeStep);
        return;
      }

      this.laserAlpha -= 0.035;

      if (this.laserAlpha > 0) {
        this.renderLaserLine(view);
        this.laserAnimId = requestAnimationFrame(fadeStep);
      } else {
        this.clearLayer(view.uiCtx, view);
        this.laserPoints = [];
        this.laserState = 'idle';
        this.laserAnimId = null;
      }
    };

    fadeStep();
  }

  snapLineAngle(x1, y1, x2, y2) {

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 6) return { x2, y2 };

    let angleRad = Math.atan2(dy, dx);
    let angleDeg = (angleRad * 180 / Math.PI) % 360;
    if (angleDeg < 0) angleDeg += 360;

    // Snapping targets: 0 (Horizontal right), 45, 90 (Vertical down), 135, 180 (Horizontal left), 225, 270, 315, 360
    const snapTargets = [0, 45, 90, 135, 180, 225, 270, 315, 360];
    const snapThreshold = 12;

    for (let target of snapTargets) {
      if (Math.abs(angleDeg - target) <= snapThreshold) {
        const snappedRad = target * Math.PI / 180;
        return {
          x2: x1 + Math.cos(snappedRad) * len,
          y2: y1 + Math.sin(snappedRad) * len
        };
      }
    }

    return { x2, y2 };
  }

  renderShapePreview(view, shape) {

    this.clearLayer(view.activeCtx, view);
    const ctx = view.activeCtx;
    ctx.save();

    const tool = window.ToolState.currentTool;
    if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = window.ToolState.highlighterColor;
      ctx.lineWidth   = window.ToolState.highlighterSize;
    } else if (tool === 'pencil') {
      ctx.strokeStyle = window.ToolState.pencilColor;
      ctx.lineWidth   = window.ToolState.pencilSize;
      ctx.globalAlpha = 0.8;
    } else {
      ctx.strokeStyle = window.ToolState.color;
      ctx.lineWidth   = window.ToolState.size;
    }
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    if (shape.type === 'line') {
      ctx.beginPath(); ctx.moveTo(shape.x1, shape.y1); ctx.lineTo(shape.x2, shape.y2); ctx.stroke();
    } else if (shape.type === 'circle') {
      ctx.beginPath(); ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2); ctx.stroke();
    } else if (shape.type === 'rectangle') {
      ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
    } else if (shape.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(shape.p1.x, shape.p1.y);
      ctx.lineTo(shape.p2.x, shape.p2.y);
      ctx.lineTo(shape.p3.x, shape.p3.y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  commitShape(view, shape) {
    const points = [];
    if (shape.type === 'line') {
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        points.push({
          x: shape.x1 + (shape.x2 - shape.x1) * t,
          y: shape.y1 + (shape.y2 - shape.y1) * t,
          pressure: 0.8
        });
      }
    } else if (shape.type === 'rectangle') {

      points.push(
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.w, y: shape.y },
        { x: shape.x + shape.w, y: shape.y + shape.h },
        { x: shape.x, y: shape.y + shape.h },
        { x: shape.x, y: shape.y }
      );
    } else if (shape.type === 'circle') {
      const step = 0.08;
      for (let a = 0; a <= Math.PI * 2 + step; a += step) {
        points.push({ x: shape.cx + Math.cos(a) * shape.r, y: shape.cy + Math.sin(a) * shape.r });
      }
      points.push({ x: shape.cx + shape.r, y: shape.cy });
    } else if (shape.type === 'triangle') {
      points.push(
        { x: shape.p1.x, y: shape.p1.y },
        { x: shape.p2.x, y: shape.p2.y },
        { x: shape.p3.x, y: shape.p3.y },
        { x: shape.p1.x, y: shape.p1.y }
      );
    }

    const tool = window.ToolState.currentTool;
    const isHighlighter = (tool === 'highlighter');
    const isPencil = (tool === 'pencil');

    const stroke = {
      id: 'shape-' + Date.now(),
      tool: tool === 'shape' ? 'pen' : tool,
      penStyle: isHighlighter ? 'highlighter' : isPencil ? 'pencil' : window.ToolState.penStyle,
      color: isHighlighter ? window.ToolState.highlighterColor : isPencil ? window.ToolState.pencilColor : window.ToolState.color,
      size:  isHighlighter ? window.ToolState.highlighterSize  : isPencil ? window.ToolState.pencilSize  : window.ToolState.size,
      points
    };

    if (!view.pageData.strokes) view.pageData.strokes = [];
    view.pageData.strokes.push(stroke);
    this.renderPageStrokes(view);

    if (shape.type === 'line') {
      this.activeLineStroke = stroke;
      this.activeLineEndpoints = {
        p1: { x: shape.x1, y: shape.y1 },
        p2: { x: shape.x2, y: shape.y2 }
      };
      this.renderLineEndpoints(view);
    }

    // Only auto-select bounding box if using shape tool
    if (tool === 'shape' && shape.type !== 'line') {
      this.selectedStrokes = [stroke];
      this.selectedImages = [];
      this.selectedTextBoxes = [];
      this.computeSelectionBoundingBox();
      this.renderSelectionBoundingBox(view);
    }

    this.onPageModified(view.index);
  }




  addTextBox(view, x, y, text = '') {
    if (!view.pageData.textBoxes) view.pageData.textBoxes = [];

    // Debounce: If there is an active editing text box created in the last 600ms, keep it focused
    const recentEditing = view.pageData.textBoxes.find(tb => tb.state === 'editing' && tb.createdAt && (Date.now() - tb.createdAt < 600));
    if (recentEditing) {
      return;
    }

    // Clean up any existing empty text boxes first
    view.pageData.textBoxes = view.pageData.textBoxes.filter(tb => {
      if (tb.state === 'editing' && (!tb.text || tb.text.trim() === '' || tb.text === 'พิมพ์ข้อความที่นี่...')) {
        return false;
      }
      if (tb.state === 'editing') tb.state = 'confirmed';
      return true;
    });

    this.onBeforePageModified(view.index);

    const newBox = {
      id: 'text-' + Date.now(),
      x, y,
      text: text || '',
      fontSize: window.ToolState.textFontSize || 18,
      color: window.ToolState.textColor || '#1C1C1E',
      state: 'editing',
      createdAt: Date.now()
    };

    view.pageData.textBoxes.push(newBox);
    this.renderPageTextOverlays(view);
    this.onPageModified(view.index);
  }


  selectTextBoxInLasso(view, tb) {
    if (!view || !tb) return;
    tb.state = 'confirmed';
    this.renderPageTextOverlays(view);

    // Auto-switch active toolbar tool to Lasso tool when text box is confirmed/placed!
    if (window.selectTool) {
      window.selectTool('lasso');
    }

    this.selectedTextBoxes = [tb];
    this.selectedStrokes   = [];
    this.selectedImages    = [];
    this.computeSelectionBoundingBox();
    this.renderSelectionBoundingBox(view);
  }

  renderPageTextOverlays(view) {
    view.textOverlays.innerHTML = '';
    if (!view.pageData || !view.pageData.textBoxes) return;

    view.pageData.textBoxes.forEach((tb) => {
      if (!tb.state) tb.state = 'confirmed';

      const el = document.createElement('div');
      el.className = `text-box-element ${tb.state}`;
      el.style.left = `${tb.x}px`;
      el.style.top = `${tb.y}px`;
      el.style.fontSize = `${tb.fontSize}px`;
      el.style.color = tb.color;

      if (tb.state === 'editing') {
        const textarea = document.createElement('textarea');
        textarea.className = 'text-box-textarea';
        textarea.value = (tb.text === 'พิมพ์ข้อความที่นี่...') ? '' : tb.text;
        textarea.placeholder = 'พิมพ์ข้อความที่นี่...';
        textarea.setAttribute('inputmode', 'text');
        textarea.setAttribute('enterkeyhint', 'done');
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('tabindex', '0');
        textarea.style.fontSize = `${tb.fontSize}px`;
        textarea.style.color = tb.color;

        const stopEvent = (e) => {
          e.stopPropagation();
        };

        textarea.addEventListener('pointerdown', stopEvent);
        textarea.addEventListener('touchstart', (e) => {
          e.stopPropagation();
          textarea.focus();
        }, { passive: false });
        textarea.addEventListener('click', stopEvent);

        textarea.addEventListener('input', () => {
          tb.text = textarea.value;
          this.onPageModified(view.index);
        });

        let isBlurred = false;
        textarea.addEventListener('blur', () => {
          if (isBlurred) return;

          // Ignore premature blur event triggered by trailing touch/click event right after creation
          if (tb.createdAt && (Date.now() - tb.createdAt < 500)) {
            textarea.focus();
            return;
          }

          isBlurred = true;

          const trimmed = (textarea.value || '').trim();
          if (!trimmed || trimmed === 'พิมพ์ข้อความที่นี่...') {
            // Remove empty text box if user blurred without typing
            view.pageData.textBoxes = view.pageData.textBoxes.filter(t => t.id !== tb.id);
            this.renderPageTextOverlays(view);
            this.onPageModified(view.index);
          } else {
            tb.text = trimmed;
            this.selectTextBoxInLasso(view, tb);
            this.onPageModified(view.index);
          }
        });

        el.appendChild(textarea);

        // Immediate synchronous focus while within active user gesture stack for ChromeOS VK
        textarea.focus();
        try {
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        } catch(e) {}

        requestAnimationFrame(() => {
          if (document.body.contains(textarea)) {
            textarea.focus();
          }
        });
      } else {
        el.innerText = tb.text;
        tb._el = el; // Reference element for Lasso bounding box measurement

        const handleBoxTap = (e) => {
          e.stopPropagation();
          // If Eraser tool is active, erase this text box immediately!
          if (window.ToolState.currentTool === 'eraser') {
            view.pageData.textBoxes = view.pageData.textBoxes.filter(t => t.id !== tb.id);
            this.renderPageTextOverlays(view);
            this.onPageModified(view.index);
            return;
          }
          // If Text Tool is active, single tap opens editing mode & triggers virtual keyboard immediately!
          if (window.ToolState.currentTool === 'text') {
            tb.state = 'editing';
            this.renderPageTextOverlays(view);
          } else {
            this.selectTextBoxInLasso(view, tb);
          }
        };

        const dblEdit = (e) => {
          e.stopPropagation();
          tb.state = 'editing';
          this.renderPageTextOverlays(view);
        };

        el.addEventListener('click', handleBoxTap);
        el.addEventListener('dblclick', dblEdit);

        // Chromebook touch handling
        let _lastTap = 0;
        el.addEventListener('touchend', (e) => {
          const now = Date.now();
          if (window.ToolState.currentTool === 'text') {
            e.preventDefault();
            e.stopPropagation();
            tb.state = 'editing';
            this.renderPageTextOverlays(view);
          } else if (now - _lastTap < 350) {
            // Double-tap in non-text tool mode switches to editing
            e.preventDefault();
            e.stopPropagation();
            tb.state = 'editing';
            this.renderPageTextOverlays(view);
          }
          _lastTap = now;
        }, { passive: false });
      }


      ['tl', 'tr', 'bl', 'br'].forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `box-handle ${pos}`;
        el.appendChild(handle);
      });

      let isDraggingBox = false;
      let boxDragStart = null;

      el.addEventListener('pointerdown', (e) => {
        if (tb.state === 'confirmed') return;

        e.stopPropagation();

        if (tb.state === 'selected') {
          this.onBeforePageModified(view.index);
          isDraggingBox = true;
          boxDragStart = { x: e.clientX, y: e.clientY, initX: tb.x, initY: tb.y };
          el.setPointerCapture(e.pointerId);
        }
      });

      el.addEventListener('pointermove', (e) => {
        if (isDraggingBox && boxDragStart) {
          const dx = (e.clientX - boxDragStart.x) / this.zoom;
          const dy = (e.clientY - boxDragStart.y) / this.zoom;
          tb.x = boxDragStart.initX + dx;
          tb.y = boxDragStart.initY + dy;
          el.style.left = `${tb.x}px`;
          el.style.top = `${tb.y}px`;
        }
      });

      el.addEventListener('pointerup', (e) => {
        if (isDraggingBox) {
          isDraggingBox = false;
          boxDragStart = null;
          this.onPageModified(view.index);
        }
      });

      view.textOverlays.appendChild(el);

    });
  }

  insertImageOverlay(viewIndex, dataUrl) {
    const view = this.pageViews[viewIndex || this.activePageIndex || 0];
    if (!view) return;

    if (!view.pageData.images) view.pageData.images = [];

    const imgObj = new Image();
    imgObj.onload = () => {
      let w = imgObj.naturalWidth || 400;
      let h = imgObj.naturalHeight || 300;

      const maxW = 420;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }

      const newImg = {
        id: 'img-' + Date.now(),
        src: dataUrl,
        x: 120,
        y: 120,
        w,
        h,
        naturalWidth: imgObj.naturalWidth,
        naturalHeight: imgObj.naturalHeight,
        state: 'selected'
      };

      view.pageData.images.push(newImg);
      this.renderPageImages(view);
      this.onPageModified(view.index);
    };
    imgObj.src = dataUrl;
  }

  renderPageImages(view) {
    view.imageOverlays.innerHTML = '';
    if (!view.pageData || !view.pageData.images) return;

    view.pageData.images.forEach((imgObj) => {
      if (!imgObj.state) imgObj.state = 'confirmed';

      const container = document.createElement('div');
      container.className = `image-box-element ${imgObj.state}`;
      container.style.left = `${imgObj.x}px`;
      container.style.top = `${imgObj.y}px`;
      container.style.width = `${imgObj.w}px`;
      container.style.height = `${imgObj.h}px`;

      const imgEl = document.createElement('img');
      imgEl.src = imgObj.src;
      container.appendChild(imgEl);

      ['tl', 'tr', 'bl', 'br'].forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `box-handle ${pos}`;
        container.appendChild(handle);

        let isResizing = false;
        let resizeStart = null;

        handle.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          this.onBeforePageModified(view.index);
          isResizing = true;
          resizeStart = { x: e.clientX, y: e.clientY, initW: imgObj.w, initH: imgObj.h, initX: imgObj.x, initY: imgObj.y };
          handle.setPointerCapture(e.pointerId);
        });

        handle.addEventListener('pointermove', (e) => {
          if (isResizing && resizeStart) {
            const dx = (e.clientX - resizeStart.x) / this.zoom;
            const aspect = resizeStart.initW / (resizeStart.initH || 1);

            let newW = resizeStart.initW;
            let newH = resizeStart.initH;
            let newX = resizeStart.initX;
            let newY = resizeStart.initY;

            if (pos === 'br' || pos === 'tr') {
              newW = Math.max(40, resizeStart.initW + dx);
            } else {
              newW = Math.max(40, resizeStart.initW - dx);
            }
            
            newH = Math.round(newW / aspect);

            if (pos === 'tl' || pos === 'bl') {
              newX = resizeStart.initX + (resizeStart.initW - newW);
            }
            if (pos === 'tl' || pos === 'tr') {
              newY = resizeStart.initY + (resizeStart.initH - newH);
            }

            imgObj.w = newW;
            imgObj.h = newH;
            imgObj.x = newX;
            imgObj.y = newY;

            container.style.left = `${imgObj.x}px`;
            container.style.top = `${imgObj.y}px`;
            container.style.width = `${imgObj.w}px`;
            container.style.height = `${imgObj.h}px`;
          }
        });

        handle.addEventListener('pointerup', (e) => {
          if (isResizing) {
            isResizing = false;
            resizeStart = null;
            this.onPageModified(view.index);
          }
        });
      });

      let isDraggingImg = false;
      let imgDragStart = null;

      container.addEventListener('pointerdown', (e) => {
        if (imgObj.state === 'confirmed') return;

        e.stopPropagation();

        if (imgObj.state === 'selected') {
          this.onBeforePageModified(view.index);
          isDraggingImg = true;
          imgDragStart = { x: e.clientX, y: e.clientY, initX: imgObj.x, initY: imgObj.y };
          container.setPointerCapture(e.pointerId);
        }
      });

      container.addEventListener('pointermove', (e) => {
        if (isDraggingImg && imgDragStart) {
          const dx = (e.clientX - imgDragStart.x) / this.zoom;
          const dy = (e.clientY - imgDragStart.y) / this.zoom;
          imgObj.x = imgDragStart.initX + dx;
          imgObj.y = imgDragStart.initY + dy;
          container.style.left = `${imgObj.x}px`;
          container.style.top = `${imgObj.y}px`;
        }
      });

      container.addEventListener('pointerup', (e) => {
        if (isDraggingImg) {
          isDraggingImg = false;
          imgDragStart = null;
          this.onPageModified(view.index);
        }
      });

      view.imageOverlays.appendChild(container);
    });
  }
};
