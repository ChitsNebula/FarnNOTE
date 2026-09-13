/**
 * Library Controller — Custom Context Popover, Custom Cover Image & Folder/Group System
 */

window.LibraryController = class LibraryController {
  constructor(app) {
    this.app = app;
    
    this.grid = document.getElementById('notebook-grid');
    this.emptyState = document.getElementById('empty-state');
    this.searchInput = document.getElementById('library-search');
    this.btnClearSearch = document.getElementById('btn-clear-search');
    this.countAllBadge = document.getElementById('count-all');
    this.modalNewNotebook = document.getElementById('modal-new-notebook');

    this.newTitleInput = document.getElementById('new-notebook-title');
    this.newGroupSelect = document.getElementById('new-notebook-group');
    this.newTemplateSelect = document.getElementById('new-notebook-template');
    this.coverPreviewBand = document.getElementById('modal-cover-band');
    this.coverPreviewIcon = document.getElementById('modal-cover-icon');
    this.coverPreviewTitle = document.getElementById('modal-cover-title-text');
    this.coverPreviewCard = document.getElementById('modal-cover-preview');

    this.contextMenu = document.getElementById('notebook-context-menu');
    this.customDialog = document.getElementById('modal-custom-dialog');

    this.selectedColor = '#FF9500';
    this.selectedIcon = 'fa-graduation-cap';
    this.selectedCoverImage = null;
    this.currentFilter = 'all';
    this.activeContextMenuNotebook = null;
    this._allNotebooks = [];

    this.initEvents();
  }

  async loadLibrary() {
    const notebooks = await window.Storage.getAllNotebooks();
    this._allNotebooks = notebooks || [];
    this.populateGroupSelects();
    this.renderSidebarGroups(this._allNotebooks);
    this.renderNotebooks(this._allNotebooks);
    this.updateCountBadge(this._allNotebooks.length);
  }

  renderSidebarGroups(notebooks) {
    const groupsContainer = document.getElementById('sidebar-groups-list');
    if (!groupsContainer) return;

    groupsContainer.innerHTML = '';
    const groups = window.Storage.getGroups();

    groups.forEach(g => {
      const count = notebooks.filter(n => n.groupId === g.id).length;
      const btn = document.createElement('button');
      btn.className = `nav-item ${this.currentFilter === g.id ? 'active' : ''}`;
      btn.dataset.filter = g.id;

      btn.innerHTML = `
        <i class="fa-solid fa-folder" style="color: ${g.color || '#007AFF'};"></i>
        <span>${g.name}</span>
        <span class="badge">${count}</span>
        <span class="btn-delete-group" data-id="${g.id}" title="ลบกลุ่มนี้">
          <i class="fa-solid fa-xmark"></i>
        </span>
      `;

      btn.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-group')) {
          e.stopPropagation();
          this.confirmDeleteGroup(g);
          return;
        }
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = g.id;
        document.getElementById('library-section-name').innerText = `กลุ่ม: ${g.name}`;
        this.loadLibrary();
      });

      groupsContainer.appendChild(btn);
    });
  }

  confirmDeleteGroup(group) {
    this.showCustomDialog({
      title: 'ลบกลุ่ม / โฟลเดอร์',
      message: `คุณต้องการลบกลุ่ม "${group.name}" หรือไม่?\n(สมุดโน้ตในกลุ่มนี้จะกลายเป็นสมุดโน้ตทั่วไป ไม่ได้ถูกลบไปดียังอยู่ครบทุกเล่ม)`,
      onConfirm: async () => {
        window.Storage.deleteGroup(group.id);
        const notebooks = await window.Storage.getAllNotebooks();
        for (const nb of notebooks) {
          if (nb.groupId === group.id) {
            nb.groupId = null;
            await window.Storage.saveNotebook(nb);
          }
        }
        if (this.currentFilter === group.id) {
          this.currentFilter = 'all';
          document.getElementById('library-section-name').innerText = 'สมุดโน้ตทั้งหมด';
        }
        this.loadLibrary();
      }
    });
  }

  populateGroupSelects() {
    const groups = window.Storage.getGroups();
    if (this.newGroupSelect) {
      this.newGroupSelect.innerHTML = '<option value="">-- ไม่จัดเข้ากลุ่ม (ทั่วไป) --</option>';
      groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.innerText = `📁 ${g.name}`;
        this.newGroupSelect.appendChild(opt);
      });
    }
  }

  updateCountBadge(count) {
    if (this.countAllBadge) this.countAllBadge.innerText = count;
  }

  renderNotebooks(notebooks) {
    this.grid.innerHTML = '';

    let filtered = notebooks || [];

    if (this.currentFilter === 'favorites') {
      filtered = filtered.filter(n => n.favorite);
    } else if (this.currentFilter === 'recent') {
      filtered = filtered.slice(0, 4);
    } else if (this.currentFilter.startsWith('group-')) {
      const groupId = this.currentFilter;
      filtered = filtered.filter(n => n.groupId === groupId);
    }

    const groups = window.Storage.getGroups();
    const rawQuery = this.searchInput ? this.searchInput.value.trim() : '';
    const query = rawQuery.toLowerCase();

    if (this.btnClearSearch) {
      this.btnClearSearch.classList.toggle('hidden', !rawQuery);
    }

    if (query) {
      filtered = filtered.filter(n => {
        const titleMatch = (n.title || '').toLowerCase().includes(query);
        const originalFileMatch = (n.originalFileName || '').toLowerCase().includes(query);
        const group = groups.find(g => g.id === n.groupId);
        const groupMatch = group && group.name.toLowerCase().includes(query);
        return titleMatch || originalFileMatch || groupMatch;
      });
    }

    if (filtered.length === 0) {
      this.emptyState.classList.remove('hidden');
      const emptyTitle = this.emptyState.querySelector('h3');
      const emptyDesc = this.emptyState.querySelector('p');
      const emptyBtn = this.emptyState.querySelector('button');
      if (query) {
        if (emptyTitle) emptyTitle.innerText = 'ไม่พบผลการค้นหา';
        if (emptyDesc) emptyDesc.innerText = `ไม่พบสมุดโน้ตหรือเอกสารที่ตรงกับ "${rawQuery}"`;
        if (emptyBtn) emptyBtn.classList.add('hidden');
      } else {
        if (emptyTitle) emptyTitle.innerText = 'ยังไม่มีสมุดโน้ต';
        if (emptyDesc) emptyDesc.innerText = 'เริ่มต้นสร้างสมุดโน้ตเล่มแรก หรือ นำเข้าไฟล์ PDF เพื่อเริ่มจดบันทึก';
        if (emptyBtn) emptyBtn.classList.remove('hidden');
      }
      return;
    }

    this.emptyState.classList.add('hidden');

    filtered.forEach(nb => {
      const card = document.createElement('div');
      card.className = 'notebook-card';
      
      const updatedDate = new Date(nb.updatedAt).toLocaleDateString('th-TH', {
        day: 'numeric', month: 'short'
      });

      const groupObj = groups.find(g => g.id === nb.groupId);
      const groupBadgeHtml = groupObj ? `<span class="group-badge-pill">📁 ${groupObj.name}</span>` : '';

      const coverStyle = nb.coverImage ? 
        `background-color: ${nb.coverColor || '#FF9500'};` : 
        `background-color: ${nb.coverColor || '#FF9500'};`;

      const coverImageOverlayHtml = nb.coverImage ? 
        `<div class="cover-custom-image" style="background-image: url('${nb.coverImage}');"></div>` : '';

      card.innerHTML = `
        <div class="notebook-cover" style="${coverStyle}">
          ${coverImageOverlayHtml}
          <div class="cover-band"></div>
          ${nb.favorite ? '<i class="fa-solid fa-star fav-badge"></i>' : ''}
          <div class="cover-icon"><i class="fa-solid ${nb.coverIcon || 'fa-book'}"></i></div>
          <div class="cover-title-text">${nb.title}</div>
        </div>
        <div class="notebook-info">
          <div class="notebook-meta">
            <span class="title" title="${nb.title}">${nb.title}</span>
            <span class="subtitle">${nb.pageCount || 1} หน้า • ${updatedDate} ${groupBadgeHtml}</span>
          </div>
          <div class="notebook-actions">
            <button class="btn-icon-sm btn-nb-menu" data-id="${nb.id}" title="จัดการ">
              <i class="fa-solid fa-ellipsis-vertical"></i>
            </button>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-nb-menu')) {
          e.stopPropagation();
          const btn = e.target.closest('.btn-nb-menu');
          this.showNotebookContextPopover(nb, btn);
          return;
        }
        this.app.openNotebook(nb.id);
      });

      this.grid.appendChild(card);
      this.loadNotebookCoverPreview(card, nb);
    });
  }

  async loadNotebookCoverPreview(card, nb) {
    const coverEl = card.querySelector('.notebook-cover');
    if (!coverEl) return;

    let previewUrl = nb.coverImage || nb._coverPreviewUrl;

    // If no coverImage, check if we have page 1 asset or pages in storage
    if (!previewUrl) {
      try {
        // 1. Check direct asset key: asset-[nb.id]-page-1
        const blob = await window.Storage.getAsset(`asset-${nb.id}-page-1`);
        if (blob) {
          previewUrl = URL.createObjectURL(blob);
          nb._coverPreviewUrl = previewUrl;
        }
      } catch (e) {}
    }

    if (!previewUrl) {
      try {
        // 2. Check notebook pages in IndexedDB
        const pages = await window.Storage.getPagesForNotebook(nb.id);
        if (pages && pages.length > 0) {
          const firstPage = pages[0];
          if (firstPage.pdfAssetId) {
            const blob = await window.Storage.getAsset(firstPage.pdfAssetId);
            if (blob) {
              previewUrl = URL.createObjectURL(blob);
              nb._coverPreviewUrl = previewUrl;
            }
          }
        }
      } catch (e) {}
    }

    // 3. If still no preview and it's a PDF notebook, render Page 1 on demand from raw PDF
    if (!previewUrl && (nb.template === 'pdf' || nb.coverIcon === 'fa-file-pdf') && window.PDFEngine && window.PDFEngine.getPDFDoc) {
      try {
        const pdfDoc = await window.PDFEngine.getPDFDoc(nb.id, window.Storage);
        if (pdfDoc) {
          const page = await pdfDoc.getPage(1);
          const vp = page.getViewport({ scale: 1.0 });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width);
          c.height = Math.round(vp.height);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;

          previewUrl = c.toDataURL('image/jpeg', 0.85);
          nb.coverImage = previewUrl;
          window.Storage.saveNotebook(nb).catch(() => {});

          c.toBlob(async (b) => {
            if (b) await window.Storage.saveAsset(`asset-${nb.id}-page-1`, b);
          }, 'image/webp', 0.95);
        }
      } catch (e) {}
    }

    if (previewUrl) {
      coverEl.classList.add('has-slide-preview');
      coverEl.innerHTML = `
        <div class="cover-slide-wrapper">
          <img src="${previewUrl}" class="cover-slide-img" alt="${nb.title}" loading="lazy">
        </div>
        ${nb.favorite ? '<i class="fa-solid fa-star fav-badge"></i>' : ''}
        ${(nb.template === 'pdf' || nb.coverIcon === 'fa-file-pdf') ? '<div class="cover-page-badge"><i class="fa-solid fa-file-pdf"></i> PDF</div>' : ''}
      `;
    }
  }

  initEvents() {
    // ── Search Input & Clear Button ──────────────────────────────────────────
    if (this.searchInput) {
      const handleSearch = () => {
        if (this._allNotebooks && this._allNotebooks.length) {
          this.renderNotebooks(this._allNotebooks);
        } else {
          this.loadLibrary();
        }
      };

      this.searchInput.addEventListener('input', handleSearch);

      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.searchInput.value = '';
          handleSearch();
          this.searchInput.blur();
        }
      });
    }

    if (this.btnClearSearch) {
      this.btnClearSearch.addEventListener('click', () => {
        if (this.searchInput) {
          this.searchInput.value = '';
          this.searchInput.focus();
        }
        if (this._allNotebooks && this._allNotebooks.length) {
          this.renderNotebooks(this._allNotebooks);
        } else {
          this.loadLibrary();
        }
      });
    }

    // ── Fullscreen Toggle on Library Header ──────────────────────────────────
    const btnLibFs = document.getElementById('btn-library-fullscreen');
    const libFsIcon = document.getElementById('library-fullscreen-icon');
    if (btnLibFs && libFsIcon) {
      const updateLibFsIcon = () => {
        const isFs = !!document.fullscreenElement;
        libFsIcon.className = isFs ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        btnLibFs.title = isFs ? 'ออกจากเต็มหน้าจอ (F11)' : 'เต็มหน้าจอ (F11)';
      };

      btnLibFs.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });

      document.addEventListener('fullscreenchange', updateLibFsIcon);
      updateLibFsIcon();
    }

    // ── Check for Updates ────────────────────────────────────────────────────
    const btnCheckUpdate = document.getElementById('btn-check-update');
    const updateIcon = document.getElementById('update-btn-icon');
    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener('click', async () => {
        if (!window.location.protocol.startsWith('http')) {
          if (window.CustomDialog && window.CustomDialog.alert) {
            window.CustomDialog.alert(
              'ตรวจหาการอัปเดต',
              'ขณะนี้คุณเปิดแอปแบบไฟล์เครื่อง (file://)\n\nหากต้องการอัปเดตเป็นเวอร์ชันล่าสุด เพียงดับเบิลคลิกไฟล์ update.bat ในโฟลเดอร์ FarmNotes ได้ทันทีโดยไม่ต้องดาวน์โหลดใหม่ครับ'
            );
          } else {
            alert('คุณกำลังเปิดแบบไฟล์เครื่อง (file://)\nดับเบิลคลิกไฟล์ update.bat ในโฟลเดอร์เพื่ออัปเดตได้ทันทีครับ');
          }
          return;
        }

        if (updateIcon) updateIcon.classList.add('fa-spin');
        btnCheckUpdate.disabled = true;

        if (window.CustomDialog && window.CustomDialog.toast) {
          window.CustomDialog.toast('กำลังตรวจหาอัปเดตเวอร์ชันใหม่...');
        }

        // On GitHub Pages or web hosting, purge Cache Storage & Service Workers, then reload cleanly
        if (window.location.hostname.includes('github.io') || (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')) {
          try {
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.map(k => caches.delete(k)));
            }
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              for (const r of regs) await r.unregister();
            }
          } catch (e) {}
          localStorage.setItem('farmnotes_app_version', '2.10.1');
          if (window.CustomDialog && window.CustomDialog.toast) {
            window.CustomDialog.toast('ล้างแคชและอัปเดตเวอร์ชันล่าสุดสำเร็จ! กำลังรีโหลด...', 2500);
          }
          setTimeout(() => {
            window.location.href = window.location.pathname + '?reload=' + Date.now();
          }, 800);
          return;
        }

        try {
          const res = await fetch('/api/update');
          const data = await res.json();
          if (data.success) {
            if (data.upToDate) {
              if (window.CustomDialog && window.CustomDialog.toast) {
                window.CustomDialog.toast('ระบบของคุณเป็นเวอร์ชันล่าสุดแล้ว! ✨');
              }
            } else {
              if (window.CustomDialog && window.CustomDialog.toast) {
                window.CustomDialog.toast('อัปเดตเวอร์ชันใหม่เรียบร้อย! กำลังรีโหลดหน้าเว็บ...', 3000);
              }
              setTimeout(() => {
                window.location.reload();
              }, 1200);
            }
          } else {
            if (window.CustomDialog && window.CustomDialog.alert) {
              window.CustomDialog.alert('การอัปเดตไม่สำเร็จ', data.error || 'ไม่สามารถติดต่อเซิร์ฟเวอร์หรือดึงข้อมูลจาก GitHub ได้');
            } else {
              alert('การอัปเดตไม่สำเร็จ: ' + (data.error || 'เกิดข้อผิดพลาด'));
            }
          }
        } catch (err) {
          console.error('Update check failed:', err);
          if (window.CustomDialog && window.CustomDialog.alert) {
            window.CustomDialog.alert(
              'ไม่สามารถอัปเดตได้',
              'ไม่สามารถเรียก API อัปเดตได้ (เซิร์ฟเวอร์อาจไม่ได้เปิดด้วย server.py)\n\nคุณสามารถดับเบิลคลิกไฟล์ update.bat ในโฟลเดอร์ FarmNotes เพื่ออัปเดตแทนได้ทันทีครับ'
            );
          } else {
            alert('ไม่สามารถอัปเดตได้: ดับเบิลคลิกไฟล์ update.bat ในโฟลเดอร์ FarmNotes แทนได้ครับ');
          }
        } finally {
          if (updateIcon) updateIcon.classList.remove('fa-spin');
          btnCheckUpdate.disabled = false;
        }
      });
    }

    // ── Backup Data (Safe Chunked Export) ────────────────────────────────────
    const btnBackup = document.getElementById('btn-backup-data');
    if (btnBackup) {
      btnBackup.addEventListener('click', async () => {
        try {
          if (window.CustomDialog && window.CustomDialog.toast) {
            window.CustomDialog.toast('กำลังเริ่มสำรองข้อมูลสมุดโน้ต...');
          }
          btnBackup.disabled = true;

          const res = await window.Storage.downloadBackupFile((curr, total, count) => {
            if (window.CustomDialog && window.CustomDialog.toast) {
              window.CustomDialog.toast(`กำลังดาวน์โหลดส่วนที่ ${curr}/${total} (${count} เล่ม)...`);
            }
          });

          if (window.CustomDialog && window.CustomDialog.alert) {
            if (res && res.totalChunks > 1) {
              window.CustomDialog.alert(
                'สำรองข้อมูลสำเร็จ!',
                `เนื่องจากคุณมีสมุดโน้ตและเอกสาร PDF ขนาดใหญ่ ระบบได้แบ่งดาวน์โหลดเป็น ${res.totalChunks} ไฟล์เรียบร้อยแล้ว\n\nเมื่อไปที่เว็บใหม่ เพียงกดปุ่มกู้คืน (☁️⬆️) แล้วนำเข้าทีละไฟล์จนครบได้เลยครับ!`
              );
            } else {
              window.CustomDialog.alert('สำรองข้อมูลสำเร็จ!', 'ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อยแล้ว');
            }
          }
        } catch (err) {
          console.error('Backup error:', err);
          if (window.CustomDialog && window.CustomDialog.alert) {
            window.CustomDialog.alert('เกิดข้อผิดพลาด', 'ไม่สามารถสร้างไฟล์สำรองได้: ' + err.message);
          } else {
            alert('ไม่สามารถสร้างไฟล์สำรองได้: ' + err.message);
          }
        } finally {
          btnBackup.disabled = false;
        }
      });
    }

    // ── Restore Data (Import All) ────────────────────────────────────────────
    const btnRestore = document.getElementById('btn-restore-data');
    const backupFileInput = document.getElementById('backup-file-input');
    if (btnRestore && backupFileInput) {
      btnRestore.addEventListener('click', () => {
        backupFileInput.value = '';
        backupFileInput.click();
      });

      backupFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          if (window.CustomDialog && window.CustomDialog.toast) {
            window.CustomDialog.toast('กำลังนำเข้าข้อมูลและรูปภาพ...');
          }
          const text = await file.text();
          const result = await window.Storage.importAllData(text);

          await this.loadLibrary();

          if (result.notebooksCount === 0) {
            if (window.CustomDialog && window.CustomDialog.alert) {
              window.CustomDialog.alert(
                'ไม่พบสมุดโน้ตในไฟล์นี้ (0 เล่ม)',
                'ไฟล์สำรองข้อมูลที่คุณเลือกไม่มีข้อมูลสมุดโน้ตอยู่เลย\n\nสาเหตุเกิดจากตอนส่งออก คุณเปิดเครื่องมือบนเว็บแทนที่จะเปิดจากในเครื่อง\nกรุณาดูวิธีส่งออกที่ถูกต้องตามที่แนะนำนะครับ'
              );
            } else {
              alert('ไม่พบสมุดโน้ตในไฟล์นี้ (0 เล่ม)');
            }
            return;
          }

          if (window.CustomDialog && window.CustomDialog.alert) {
            window.CustomDialog.alert(
              'กู้คืนข้อมูลสำเร็จ!',
              `นำเข้าเรียบร้อยแล้ว:\n- สมุดโน้ต: ${result.notebooksCount} เล่ม\n- หน้ากระดาษ: ${result.pagesCount} หน้า\n- ไฟล์แนบ/รูปภาพ/PDF: ${result.assetsCount} รายการ`
            );
          } else {
            alert(`กู้คืนข้อมูลสำเร็จ! นำเข้าสมุดโน้ต ${result.notebooksCount} เล่มเรียบร้อยแล้ว`);
          }
        } catch (err) {
          console.error('Restore error:', err);
          if (window.CustomDialog && window.CustomDialog.alert) {
            window.CustomDialog.alert('เกิดข้อผิดพลาด', 'ไม่สามารถนำเข้าข้อมูลได้: ' + err.message);
          } else {
            alert('ไม่สามารถนำเข้าข้อมูลได้: ' + err.message);
          }
        }
      });
    }

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        document.getElementById('library-section-name').innerText = btn.querySelector('span').innerText;
        this.loadLibrary();
      });
    });

    document.getElementById('btn-new-notebook').addEventListener('click', () => {
      this.selectedCoverImage = null;
      this.modalNewNotebook.classList.remove('hidden');
    });

    document.getElementById('btn-new-group').addEventListener('click', () => {
      this.promptNewGroup();
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => this.modalNewNotebook.classList.add('hidden'));
    });

    this.newTitleInput.addEventListener('input', (e) => {
      this.coverPreviewTitle.innerText = e.target.value || 'สมุดโน้ตไม่มีชื่อ';
    });

    document.querySelectorAll('#cover-color-options .color-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#cover-color-options .color-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedColor = chip.dataset.color;
        this.coverPreviewCard.style.backgroundColor = this.selectedColor;
      });
    });

    document.querySelectorAll('#cover-icon-options .icon-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#cover-icon-options .icon-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedIcon = chip.dataset.icon;
        this.coverPreviewIcon.innerHTML = `<i class="fa-solid ${this.selectedIcon}"></i>`;
      });
    });

    this.selectedOrientation = 'portrait';
    document.querySelectorAll('#new-notebook-orientation .option-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#new-notebook-orientation .option-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.selectedOrientation = chip.dataset.orientation;

        // Update live preview card aspect ratio
        if (this.selectedOrientation === 'landscape') {
          this.coverPreviewCard.style.aspectRatio = '1.35 / 1';
        } else {
          this.coverPreviewCard.style.aspectRatio = '1 / 1.35';
        }
      });
    });

    const coverImgInput = document.getElementById('cover-image-file-input');
    document.getElementById('btn-upload-cover-img').addEventListener('click', () => coverImgInput.click());

    coverImgInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        this.selectedCoverImage = evt.target.result;
        this.coverPreviewCard.style.backgroundImage = `url('${this.selectedCoverImage}')`;
        this.coverPreviewCard.style.backgroundSize = 'cover';
        this.coverPreviewCard.style.backgroundPosition = 'center';
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('btn-submit-create-notebook').addEventListener('click', async () => {
      await this.createNewNotebook();
    });

    const pdfFileInput = document.getElementById('pdf-file-input');
    document.getElementById('btn-import-pdf').addEventListener('click', () => pdfFileInput.click());

    pdfFileInput.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        const btn = document.getElementById('btn-import-pdf');
        const origText = btn ? btn.innerHTML : '';
        if (btn) {
          btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังอ่านไฟล์ PDF...';
        }

        try {
          const nb = await window.PDFEngine.importPDF(file, window.Storage, null, (current, total) => {
            if (btn) {
              btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังนำเข้า PDF (${current}/${total})...`;
            }
          });

          if (btn) btn.innerHTML = origText;
          pdfFileInput.value = '';
          this.loadLibrary();
          this.app.openNotebook(nb.id);
        } catch (err) {
          if (btn) btn.innerHTML = origText;
          pdfFileInput.value = '';
          this.showCustomDialog('เกิดข้อผิดพลาด', 'ไม่สามารถอ่านไฟล์ PDF ได้: ' + err.message);
        }
      }
    });

    // Close Context Menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notebook-context-menu') && !e.target.closest('.btn-nb-menu')) {
        this.hideNotebookContextPopover();
      }
    });

    this.bindContextMenuEvents();
  }

  // --- SLEEK CUSTOM CONTEXT POPOVER MENU (REPLACES NATIVE 'This page says'!) ---

  showNotebookContextPopover(notebook, targetBtn) {
    this.activeContextMenuNotebook = notebook;

    const favItem = document.getElementById('ctx-fav');
    if (favItem) {
      favItem.querySelector('span').innerText = notebook.favorite ? 'ยกเลิกรายการโปรด' : 'สลับรายการโปรด';
    }

    // Show menu first so offetHeight / offsetWidth can be accurately measured
    this.contextMenu.classList.remove('hidden');

    const rect = targetBtn.getBoundingClientRect();
    const menuHeight = this.contextMenu.offsetHeight || 230;
    const menuWidth = this.contextMenu.offsetWidth || 210;

    // Smart vertical positioning: If opening downwards would spill off screen bottom, open UPWARDS
    let top;
    if (rect.bottom + menuHeight + 12 > window.innerHeight && rect.top > menuHeight) {
      top = rect.top - menuHeight - 6;
    } else {
      top = rect.bottom + 6;
    }

    // Strict clamping within viewport margins (10px from top/bottom screen edges)
    top = Math.max(10, Math.min(top, window.innerHeight - menuHeight - 10));

    // Align menu right edge with button/card right side
    let left = rect.right - menuWidth;
    left = Math.max(10, Math.min(left, window.innerWidth - menuWidth - 10));

    this.contextMenu.style.position = 'fixed';
    this.contextMenu.style.top = `${top}px`;
    this.contextMenu.style.left = `${left}px`;
    this.contextMenu.style.zIndex = '9999';
  }

  hideNotebookContextPopover() {
    this.contextMenu.classList.add('hidden');
    this.activeContextMenuNotebook = null;
  }

  bindContextMenuEvents() {
    document.getElementById('ctx-fav').addEventListener('click', () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        nb.favorite = !nb.favorite;
        window.Storage.saveNotebook(nb).then(() => this.loadLibrary());
      }
    });

    document.getElementById('ctx-cover').addEventListener('click', () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        const coverInput = document.getElementById('cover-image-file-input');
        const handler = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            nb.coverImage = evt.target.result;
            window.Storage.saveNotebook(nb).then(() => this.loadLibrary());
          };
          reader.readAsDataURL(file);
          coverInput.removeEventListener('change', handler);
        };
        coverInput.addEventListener('change', handler);
        coverInput.click();
      }
    });

    document.getElementById('ctx-group').addEventListener('click', () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        this.promptMoveToGroup(nb);
      }
    });

    document.getElementById('ctx-rename').addEventListener('click', () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        this.promptRenameNotebook(nb);
      }
    });

    document.getElementById('ctx-duplicate').addEventListener('click', async () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        await this.duplicateNotebook(nb);
      }
    });

    document.getElementById('ctx-delete').addEventListener('click', () => {
      const nb = this.activeContextMenuNotebook;
      this.hideNotebookContextPopover();
      if (nb) {
        this.confirmDeleteNotebook(nb);
      }
    });
  }

  // --- SLEEK CUSTOM MODAL DIALOGS (NO 'This page says'!) ---

  showCustomDialog({ title, message, showInput = false, inputVal = '', showSelect = false, selectOptions = [], onConfirm }) {
    const titleEl = document.getElementById('custom-dialog-title');
    const msgEl = document.getElementById('custom-dialog-message');
    const inputCont = document.getElementById('custom-dialog-input-container');
    const inputEl = document.getElementById('custom-dialog-input');
    const selectCont = document.getElementById('custom-dialog-select-container');
    const selectEl = document.getElementById('custom-dialog-select');

    titleEl.innerText = title || 'ยืนยันทำรายการ';
    msgEl.innerText = message || '';

    if (showInput) {
      inputCont.classList.remove('hidden');
      inputEl.value = inputVal;
    } else {
      inputCont.classList.add('hidden');
    }

    if (showSelect) {
      selectCont.classList.remove('hidden');
      selectEl.innerHTML = '';
      selectOptions.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.innerText = opt.label;
        if (opt.selected) o.selected = true;
        selectEl.appendChild(o);
      });
    } else {
      selectCont.classList.add('hidden');
    }

    this.customDialog.classList.remove('hidden');

    const btnConfirm = document.getElementById('btn-custom-dialog-confirm');
    const btnCancel = document.getElementById('btn-custom-dialog-cancel');
    const btnClose = this.customDialog.querySelector('.close-custom-dialog');

    const cleanup = () => {
      this.customDialog.classList.add('hidden');
      btnConfirm.replaceWith(btnConfirm.cloneNode(true));
      btnCancel.replaceWith(btnCancel.cloneNode(true));
      btnClose.replaceWith(btnClose.cloneNode(true));
    };

    document.getElementById('btn-custom-dialog-cancel').addEventListener('click', cleanup);
    this.customDialog.querySelector('.close-custom-dialog').addEventListener('click', cleanup);

    document.getElementById('btn-custom-dialog-confirm').addEventListener('click', () => {
      const inputResult = showInput ? inputEl.value : null;
      const selectResult = showSelect ? selectEl.value : null;
      cleanup();
      if (onConfirm) onConfirm(inputResult || selectResult);
    });
  }

  confirmDeleteNotebook(notebook) {
    this.showCustomDialog({
      title: 'ลบสมุดโน้ต',
      message: `คุณต้องการลบสมุดโน้ต "${notebook.title}" อย่างถาวรหรือไม่?`,
      onConfirm: async () => {
        await window.Storage.deleteNotebook(notebook.id);
        this.loadLibrary();
      }
    });
  }

  promptRenameNotebook(notebook) {
    this.showCustomDialog({
      title: 'เปลี่ยนชื่อสมุดโน้ต',
      message: 'กรอกชื่อสมุดโน้ตใหม่:',
      showInput: true,
      inputVal: notebook.title,
      onConfirm: async (newTitle) => {
        if (newTitle && newTitle.trim()) {
          notebook.title = newTitle.trim();
          await window.Storage.saveNotebook(notebook);
          this.loadLibrary();
        }
      }
    });
  }

  promptNewGroup() {
    this.showCustomDialog({
      title: 'สร้างกลุ่ม / โฟลเดอร์ใหม่',
      message: 'กรอกชื่อกลุ่มสมุดโน้ต (เช่น วิชาเรียน, งานเอกสาร):',
      showInput: true,
      inputVal: 'กลุ่มใหม่',
      onConfirm: (groupName) => {
        if (groupName && groupName.trim()) {
          const newG = {
            id: 'group-' + Date.now(),
            name: groupName.trim(),
            color: '#007AFF'
          };
          window.Storage.saveGroup(newG);
          this.loadLibrary();
        }
      }
    });
  }

  promptMoveToGroup(notebook) {
    const groups = window.Storage.getGroups();
    const options = [
      { value: '', label: '-- ไม่จัดเข้ากลุ่ม (ทั่วไป) --', selected: !notebook.groupId },
      ...groups.map(g => ({ value: g.id, label: `📁 ${g.name}`, selected: notebook.groupId === g.id }))
    ];

    this.showCustomDialog({
      title: 'จัดเข้ากลุ่ม / โฟลเดอร์',
      message: `เลือกกลุ่มสำหรับ "${notebook.title}":`,
      showSelect: true,
      selectOptions: options,
      onConfirm: async (selectedGroupId) => {
        notebook.groupId = selectedGroupId || null;
        await window.Storage.saveNotebook(notebook);
        this.loadLibrary();
      }
    });
  }

  async duplicateNotebook(notebook) {
    const newId = 'nb-copy-' + Date.now();
    const copy = {
      ...notebook,
      id: newId,
      title: `${notebook.title} (สำเนา)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await window.Storage.saveNotebook(copy);

    const originalPages = await window.Storage.getPagesForNotebook(notebook.id);
    for (let i = 0; i < originalPages.length; i++) {
      const p = originalPages[i];
      const pageCopy = {
        ...p,
        id: `page-${newId}-${i + 1}`,
        notebookId: newId
      };
      await window.Storage.savePage(pageCopy);
    }
    this.loadLibrary();
  }

  async createNewNotebook() {
    const title = this.newTitleInput.value.trim() || 'สมุดโน้ตของฉัน';
    const template = this.newTemplateSelect.value;
    const groupId = this.newGroupSelect ? this.newGroupSelect.value : '';
    const orientation = this.selectedOrientation || 'portrait';
    const isLandscape = (orientation === 'landscape');
    const width = isLandscape ? 1123 : 794;
    const height = isLandscape ? 794 : 1123;
    const nbId = 'nb-' + Date.now();

    const notebook = {
      id: nbId,
      title,
      coverColor: this.selectedColor,
      coverIcon: this.selectedIcon,
      coverImage: this.selectedCoverImage,
      groupId: groupId || null,
      template,
      orientation,
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pageCount: 1
    };

    await window.Storage.saveNotebook(notebook);

    const firstPage = {
      id: `page-${nbId}-1`,
      notebookId: nbId,
      index: 0,
      width,
      height,
      template,
      strokes: [],
      textBoxes: [],
      images: []
    };

    await window.Storage.savePage(firstPage);

    this.modalNewNotebook.classList.add('hidden');
    await this.loadLibrary();
    this.app.openNotebook(nbId);
  }
};
