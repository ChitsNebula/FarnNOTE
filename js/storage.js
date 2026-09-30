/**
 * Storage Manager — IndexedDB persistence for GoodNotes 6 Web (File Protocol Compatible)
 */

const DB_NAME = 'GoodNotesWebDB';
const DB_VERSION = 2;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('notebooks')) {
        const nbStore = db.createObjectStore('notebooks', { keyPath: 'id' });
        nbStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        nbStore.createIndex('favorite', 'favorite', { unique: false });
      }

      if (!db.objectStoreNames.contains('pages')) {
        const pageStore = db.createObjectStore('pages', { keyPath: 'id' });
        pageStore.createIndex('notebookId', 'notebookId', { unique: false });
      }

      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }

      // LifeCalendar: Event, To-Do, Deadline
      if (!db.objectStoreNames.contains('calendar_events')) {
        const evStore = db.createObjectStore('calendar_events', { keyPath: 'id' });
        evStore.createIndex('date', 'date', { unique: false });
        evStore.createIndex('type', 'type', { unique: false });
        evStore.createIndex('userId', 'userId', { unique: false });
      }

      // LifeCalendar: Reading Plans
      if (!db.objectStoreNames.contains('reading_plans')) {
        const rpStore = db.createObjectStore('reading_plans', { keyPath: 'id' });
        rpStore.createIndex('userId', 'userId', { unique: false });
      }

      // LifeCalendar: Reminders & Backlog
      if (!db.objectStoreNames.contains('reminders')) {
        const remStore = db.createObjectStore('reminders', { keyPath: 'id' });
        remStore.createIndex('userId', 'userId', { unique: false });
        remStore.createIndex('dueDate', 'dueDate', { unique: false });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return dbPromise;
}

function _sanitizePageForStorage(page) {
  if (!page) return page;
  try {
    const cleanStrokes = (page.strokes || []).map(s => {
      const cleanS = { ...s };
      delete cleanS._canvas;
      delete cleanS._img;
      delete cleanS._box;
      return cleanS;
    });

    const cleanTextBoxes = (page.textBoxes || []).map(tb => {
      const cleanTb = { ...tb };
      delete cleanTb._el;
      return cleanTb;
    });

    const cleanImages = (page.images || []).map(img => {
      const cleanImg = { ...img };
      delete cleanImg._el;
      delete cleanImg._img;
      return cleanImg;
    });

    const clean = {
      ...page,
      strokes: cleanStrokes,
      textBoxes: cleanTextBoxes,
      images: cleanImages
    };
    delete clean._cachedPdfUrl;
    delete clean._renderSession;
    return clean;
  } catch (e) {
    return page;
  }
}

window.Storage = {
  getGroups() {
    try {
      const json = localStorage.getItem('farmnotes_groups');
      return json ? JSON.parse(json) : [
        { id: 'group-study', name: 'การเรียน / วิชาการ', color: '#007AFF' },
        { id: 'group-work', name: 'การทำงาน / โปรเจกต์', color: '#34C759' }
      ];
    } catch (e) {
      return [];
    }
  },

  saveGroup(group) {
    const groups = this.getGroups();
    const existingIdx = groups.findIndex(g => g.id === group.id);
    if (existingIdx >= 0) {
      groups[existingIdx] = group;
    } else {
      groups.push(group);
    }
    localStorage.setItem('farmnotes_groups', JSON.stringify(groups));
    return groups;
  },

  deleteGroup(groupId) {
    let groups = this.getGroups();
    groups = groups.filter(g => g.id !== groupId);
    localStorage.setItem('farmnotes_groups', JSON.stringify(groups));
    return groups;
  },

  async getAllNotebooks() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readonly');
      const store = tx.objectStore('notebooks');
      const request = store.getAll();
      request.onsuccess = () => {
        const notebooks = request.result || [];
        notebooks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(notebooks);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async getNotebook(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readonly');
      const store = tx.objectStore('notebooks');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async saveNotebook(notebook) {
    notebook.updatedAt = new Date().toISOString();
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks');
      const request = store.put(notebook);
      request.onsuccess = () => resolve(notebook);
      request.onerror = () => reject(request.error);
    });
  },

  async moveToTrash(id) {
    const nb = await this.getNotebook(id);
    if (!nb) return;
    nb.trashed = true;
    nb.trashedAt = new Date().toISOString();
    await this.saveNotebook(nb);
  },

  async restoreFromTrash(id) {
    const nb = await this.getNotebook(id);
    if (!nb) return;
    nb.trashed = false;
    nb.trashedAt = null;
    await this.saveNotebook(nb);
  },

  async purgeExpiredTrash(retentionDays = 30) {
    try {
      const notebooks = await this.getAllNotebooks();
      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      const expired = notebooks.filter(nb => {
        if (!nb.trashed || !nb.trashedAt) return false;
        const trashedTime = new Date(nb.trashedAt).getTime();
        return (now - trashedTime) >= maxAgeMs;
      });

      for (const nb of expired) {
        console.log(`[Trash Auto-Purge] Automatically permanently deleting expired notebook: "${nb.title}" (${nb.id})`);
        await this.deleteNotebook(nb.id);
      }
      return expired.length;
    } catch (e) {
      console.warn('[Trash Auto-Purge] Error during purge:', e);
      return 0;
    }
  },

  async deleteNotebook(id) {
    const db = await getDB();

    // Phase 1: collect page asset IDs before deleting anything
    const pages = await this.getPagesForNotebook(id);
    const assetIds = pages
      .filter(p => p.pdfAssetId)
      .map(p => p.pdfAssetId);

    // Always include the raw-pdf master blob regardless of page records
    assetIds.push(`asset-${id}-raw-pdf`);

    // Phase 2: delete notebook + page records in one transaction
    const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
    tx.objectStore('notebooks').delete(id);

    const pageStore = tx.objectStore('pages');
    const index = pageStore.index('notebookId');
    const request = index.getAllKeys(id);

    request.onsuccess = () => {
      const pageKeys = request.result;
      pageKeys.forEach((pId) => pageStore.delete(pId));
    };

    await new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });

    // Phase 3: delete all assets (PDF blobs) — fire-and-forget, non-blocking
    // Errors are silently ignored (asset might not exist for non-PDF notebooks)
    for (const assetId of assetIds) {
      try { await this.deleteAsset(assetId); } catch (_) {}
    }

    return true;
  },

  async getPagesForNotebook(notebookId) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readonly');
      const store = tx.objectStore('pages');
      const index = store.index('notebookId');
      const request = index.getAll(notebookId);
      request.onsuccess = () => {
        const pages = request.result || [];
        pages.sort((a, b) => a.index - b.index);
        resolve(pages);
      };
      request.onerror = () => reject(request.error);
    });
  },

  async getPage(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readonly');
      const store = tx.objectStore('pages');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async savePage(page) {
    const cleanPage = _sanitizePageForStorage(page);
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      const store = tx.objectStore('pages');
      const request = store.put(cleanPage);
      request.onsuccess = () => resolve(page);
      request.onerror = () => reject(request.error);
    });
  },

  async savePagesBatch(pages) {
    if (!pages || !pages.length) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      const store = tx.objectStore('pages');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      for (const p of pages) {
        store.put(_sanitizePageForStorage(p));
      }
    });
  },

  async deletePage(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      const store = tx.objectStore('pages');
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteAsset(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      const store = tx.objectStore('assets');
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  },

  async saveAsset(id, blobData) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      const store = tx.objectStore('assets');
      const request = store.put({ id, data: blobData });
      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  },

  async getAsset(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readonly');
      const store = tx.objectStore('assets');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject(request.error);
    });
  },

  async seedInitialSampleDataIfEmpty() {
    const notebooks = await this.getAllNotebooks();
    if (notebooks.length > 0) return;

    const sample1 = {
      id: 'sample-welcome-nb',
      title: 'ยินดีต้อนรับสู่ GoodNotes 6 Web',
      coverColor: '#FF9500',
      coverIcon: 'fa-lightbulb',
      template: 'grid',
      favorite: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pageCount: 2
    };

    await this.saveNotebook(sample1);

    const page1 = {
      id: 'page-welcome-1',
      notebookId: 'sample-welcome-nb',
      index: 0,
      width: 794,
      height: 1123,
      template: 'grid',
      strokes: [
        {
          id: 's1',
          tool: 'pen',
          penStyle: 'fountain',
          color: '#FF9500',
          size: 6,
          points: [
            { x: 100, y: 150, pressure: 0.5 }, { x: 140, y: 145, pressure: 0.7 }, { x: 180, y: 155, pressure: 0.6 },
            { x: 220, y: 148, pressure: 0.8 }, { x: 260, y: 152, pressure: 0.4 }
          ]
        },
        {
          id: 's2',
          tool: 'highlighter',
          color: '#FFD60A',
          size: 24,
          points: [
            { x: 80, y: 175, pressure: 0.5 }, { x: 300, y: 175, pressure: 0.5 }
          ]
        }
      ],
      textBoxes: [
        {
          id: 't1',
          x: 100,
          y: 220,
          text: '✨ ยินดีต้อนรับสู่ FarmNotes!\n\n• ปากกาเขียนลื่นสมจริงด้วย Smooth Spline Engine\n• รองรับไฮไลท์, ยางลบวัตถุ, Lasso เลือกและย้ายวัตถุ\n• เครื่องมือรูปทรงวาดสร้างรูปทรงเรขาคณิตอัตโนมัติ\n• นำเข้าไฟล์ PDF และจดโน้ตทับพร้อมส่งออก PDF ได้ทันที',
          fontSize: 18,
          color: '#1C1C1E'
        }
      ],
      images: []
    };

    const page2 = {
      id: 'page-welcome-2',
      notebookId: 'sample-welcome-nb',
      index: 1,
      width: 794,
      height: 1123,
      template: 'lined',
      strokes: [],
      textBoxes: [
        {
          id: 't2',
          x: 100,
          y: 120,
          text: '📐 หน้าสมุดโน้ตกระดาษมีเส้น (Lined Paper)',
          fontSize: 20,
          color: '#007AFF'
        }
      ],
      images: []
    };

    await this.savePage(page1);
    await this.savePage(page2);

    const sample2 = {
      id: 'sample-physics-nb',
      title: 'สรุปวิชา Physics & Calc',
      coverColor: '#007AFF',
      coverIcon: 'fa-flask',
      template: 'cornell',
      favorite: false,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 86400000).toISOString(),
      pageCount: 1
    };
    await this.saveNotebook(sample2);

    await this.savePage({
      id: 'page-physics-1',
      notebookId: 'sample-physics-nb',
      index: 0,
      width: 794,
      height: 1123,
      template: 'cornell',
      strokes: [],
      textBoxes: [
        {
          id: 't3',
          x: 240,
          y: 120,
          text: 'Formula: E = mc²',
          fontSize: 24,
          color: '#FF3B30'
        }
      ],
      images: []
    });
  },

  // ── Backup & Restore (Full Data Migration) ─────────────────────────────────
  async exportBatch(notebooks, partLabel = 'All') {
    const db = await getDB();
    const nbIds = new Set(notebooks.map(n => n.id));

    const getAllFromStore = (storeName) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    };

    // 1. Pages for this batch
    const allPages = await getAllFromStore('pages');
    const pages = allPages.filter(p => nbIds.has(p.notebookId));

    // 2. Needed asset IDs only
    const neededAssetIds = new Set();
    for (const nb of notebooks) {
      neededAssetIds.add(`asset-${nb.id}-raw-pdf`);
      neededAssetIds.add(`asset-${nb.id}-page-1`);
    }
    for (const page of pages) {
      if (page.pdfAssetId) neededAssetIds.add(page.pdfAssetId);
    }

    // 3. Fetch only needed assets individually to avoid high RAM / SIGILL crash
    const assets = [];
    for (const assetId of neededAssetIds) {
      try {
        const blobData = await this.getAsset(assetId);
        if (!blobData) continue;
        let dataUrl = blobData;
        if (blobData instanceof Blob) {
          dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blobData);
          });
        }
        assets.push({ id: assetId, data: dataUrl });
      } catch (e) {
        console.warn('Skip asset:', assetId, e);
      }
    }

    const backupData = {
      app: 'FarmNotes',
      version: 1,
      exportedAt: new Date().toISOString(),
      part: partLabel,
      groups: this.getGroups(),
      notebooks,
      pages,
      assets
    };

    const jsonStr = JSON.stringify(backupData);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `FarmNotes_Backup_${partLabel}_${dateStr}.farmnotes`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    return {
      notebooksCount: notebooks.length,
      pagesCount: pages.length,
      assetsCount: assets.length
    };
  },

  async downloadBackupFile(onProgress) {
    const notebooks = await this.getAllNotebooks();
    if (!notebooks || notebooks.length === 0) {
      throw new Error('ไม่พบสมุดโน้ตในระบบ');
    }

    const CHUNK_SIZE = 5;
    const totalChunks = Math.ceil(notebooks.length / CHUNK_SIZE);

    if (totalChunks === 1) {
      return await this.exportBatch(notebooks, 'All');
    }

    for (let i = 0; i < totalChunks; i++) {
      const chunk = notebooks.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const partLabel = `Part${i + 1}_of_${totalChunks}`;
      if (onProgress) {
        onProgress(i + 1, totalChunks, chunk.length);
      }
      await this.exportBatch(chunk, partLabel);
      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    return { totalChunks, totalNotebooks: notebooks.length };
  },

  async importAllData(data) {
    if (typeof data === 'string') {
      data = JSON.parse(data);
    }
    if (!data || (!data.notebooks && !data.pages)) {
      throw new Error('ไฟล์สำรองข้อมูลไม่ถูกต้องหรือไม่สมบูรณ์');
    }

    // 1. Restore groups
    if (Array.isArray(data.groups) && data.groups.length > 0) {
      try {
        const existingGroups = this.getGroups();
        const groupMap = new Map();
        existingGroups.forEach(g => groupMap.set(g.id, g));
        data.groups.forEach(g => groupMap.set(g.id, g));
        localStorage.setItem('farmnotes_groups', JSON.stringify(Array.from(groupMap.values())));
      } catch (e) {
        console.warn('Could not restore groups:', e);
      }
    }

    const db = await getDB();

    // 2. Restore assets
    if (Array.isArray(data.assets)) {
      for (const a of data.assets) {
        try {
          let blob = a.data;
          if (typeof a.data === 'string' && a.data.startsWith('data:')) {
            const arr = a.data.split(',');
            const mimeMatch = arr[0].match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
              u8arr[n] = bstr.charCodeAt(n);
            }
            blob = new Blob([u8arr], { type: mime });
          }
          await this.saveAsset(a.id, blob);
        } catch (err) {
          console.warn('Error importing asset:', a.id, err);
        }
      }
    }

    // 3. Restore notebooks
    if (Array.isArray(data.notebooks)) {
      for (const nb of data.notebooks) {
        await this.saveNotebook(nb);
      }
    }

    // 4. Restore pages
    if (Array.isArray(data.pages)) {
      for (const pg of data.pages) {
        await this.savePage(pg);
      }
    }

    return {
      notebooksCount: data.notebooks ? data.notebooks.length : 0,
      pagesCount: data.pages ? data.pages.length : 0,
      assetsCount: data.assets ? data.assets.length : 0
    };
  },

  // ── LifeCalendar: Calendar Events CRUD ─────────────────────────────
  async saveCalendarEvent(event) {
    if (!event || !event.id) return null;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('calendar_events', 'readwrite');
      const store = tx.objectStore('calendar_events');
      const item = {
        ...event,
        updatedAt: Date.now(),
        createdAt: event.createdAt || Date.now()
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  },

  async getCalendarEvents(userId) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('calendar_events', 'readonly');
      const store = tx.objectStore('calendar_events');
      let req;
      if (userId && store.indexNames.contains('userId')) {
        req = store.index('userId').getAll(userId);
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => {
        let events = req.result || [];
        if (userId && !store.indexNames.contains('userId')) {
          events = events.filter(e => e.userId === userId);
        }
        resolve(events);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteCalendarEvent(id) {
    if (!id) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('calendar_events', 'readwrite');
      const store = tx.objectStore('calendar_events');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  // ── LifeCalendar: Reading Plans CRUD ──────────────────────────────
  async saveReadingPlan(plan) {
    if (!plan || !plan.id) return null;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reading_plans', 'readwrite');
      const store = tx.objectStore('reading_plans');
      const item = {
        ...plan,
        updatedAt: Date.now(),
        createdAt: plan.createdAt || Date.now()
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  },

  async getReadingPlans(userId) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reading_plans', 'readonly');
      const store = tx.objectStore('reading_plans');
      let req;
      if (userId && store.indexNames.contains('userId')) {
        req = store.index('userId').getAll(userId);
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => {
        let plans = req.result || [];
        if (userId && !store.indexNames.contains('userId')) {
          plans = plans.filter(p => p.userId === userId);
        }
        resolve(plans);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteReadingPlan(id) {
    if (!id) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reading_plans', 'readwrite');
      const store = tx.objectStore('reading_plans');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  // ── LifeCalendar: Reminders & Backlog CRUD ────────────────────────
  async saveReminder(reminder) {
    if (!reminder || !reminder.id) return null;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reminders', 'readwrite');
      const store = tx.objectStore('reminders');
      const item = {
        ...reminder,
        updatedAt: Date.now(),
        createdAt: reminder.createdAt || Date.now()
      };
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  },

  async getReminders(userId) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reminders', 'readonly');
      const store = tx.objectStore('reminders');
      let req;
      if (userId && store.indexNames.contains('userId')) {
        req = store.index('userId').getAll(userId);
      } else {
        req = store.getAll();
      }
      req.onsuccess = () => {
        let list = req.result || [];
        if (userId && !store.indexNames.contains('userId')) {
          list = list.filter(r => r.userId === userId);
        }
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteReminder(id) {
    if (!id) return;
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('reminders', 'readwrite');
      const store = tx.objectStore('reminders');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
};
