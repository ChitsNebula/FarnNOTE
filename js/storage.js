/**
 * Storage Manager — IndexedDB persistence for GoodNotes 6 Web (File Protocol Compatible)
 */

const DB_NAME = 'GoodNotesWebDB';
const DB_VERSION = 1;

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
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });

  return dbPromise;
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

  async deleteNotebook(id) {
    const db = await getDB();
    const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
    tx.objectStore('notebooks').delete(id);

    const pageStore = tx.objectStore('pages');
    const index = pageStore.index('notebookId');
    const request = index.getAllKeys(id);

    request.onsuccess = () => {
      const pageKeys = request.result;
      pageKeys.forEach((pId) => pageStore.delete(pId));
    };

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
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
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pages', 'readwrite');
      const store = tx.objectStore('pages');
      const request = store.put(page);
      request.onsuccess = () => resolve(page);
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
  }
};
