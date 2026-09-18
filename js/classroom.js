/**
 * FarmNotes — Google Classroom Explorer Engine (v2.13.0)
 * Direct Integration with Google Classroom API & Google Drive API
 * Allows students to browse courses, view materials & assignments, and 1-click import PDFs into notebooks
 */

(function () {
  'use strict';

  class ClassroomExplorer {
    constructor() {
      this.app = null;
      this.clientId = localStorage.getItem('farmnotes_google_client_id') || '';
      this.accessToken = localStorage.getItem('farmnotes_google_access_token') || null;
      this.tokenExpiresAt = parseInt(localStorage.getItem('farmnotes_google_token_expires_at') || '0', 10);
      try {
        const savedUser = localStorage.getItem('farmnotes_google_user_profile');
        this.currentUser = savedUser ? JSON.parse(savedUser) : null;
      } catch (e) {
        this.currentUser = null;
      }
      try {
        const savedCourses = localStorage.getItem('farmnotes_google_courses_cache');
        this.coursesCache = savedCourses ? JSON.parse(savedCourses) : [];
      } catch (e) {
        this.coursesCache = [];
      }
      this.currentCourse = null;
      this.tokenClient = null;

      // DOM Elements
      this.modal = null;
      this.setupView = null;
      this.coursesView = null;
      this.materialsView = null;
      this.linkImportView = null;
    }

    init(app) {
      this.app = app;
      this.bindDOMElements();
      this.bindEvents();

      // Check if Client ID exists
      if (this.clientId) {
        this.initGisTokenClient();
        // If user was previously logged in, auto-refresh token silently in background on startup
        if (this.currentUser && (!this.accessToken || Date.now() > this.tokenExpiresAt - 120000)) {
          setTimeout(() => this.trySilentRefresh(), 1200);
        }
      }
    }

    bindDOMElements() {
      this.modal = document.getElementById('classroom-modal');
      this.setupView = document.getElementById('cr-view-setup');
      this.coursesView = document.getElementById('cr-view-courses');
      this.materialsView = document.getElementById('cr-view-materials');
      this.linkImportView = document.getElementById('cr-view-link');

      this.coursesListEl = document.getElementById('cr-courses-list');
      this.materialsListEl = document.getElementById('cr-materials-list');
      this.accountBanner = document.getElementById('cr-account-banner');
      this.courseHeaderTitle = document.getElementById('cr-course-header-title');
      this.courseHeaderSubtitle = document.getElementById('cr-course-header-subtitle');
    }

    bindEvents() {
      // Open / Close Modal
      const openBtn = document.getElementById('btn-open-classroom');
      if (openBtn) {
        openBtn.addEventListener('click', () => this.open());
      }

      const closeBtn = document.getElementById('btn-close-classroom-modal');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.close());
      }

      // Close on backdrop click
      if (this.modal) {
        this.modal.addEventListener('click', (e) => {
          if (e.target === this.modal) this.close();
        });
      }

      // Save Client ID
      const saveClientBtn = document.getElementById('btn-cr-save-client-id');
      if (saveClientBtn) {
        saveClientBtn.addEventListener('click', () => {
          const input = document.getElementById('cr-client-id-input');
          const val = input ? input.value.trim() : '';
          if (!val) {
            this.showToast('กรุณากรอก Google Client ID', 2500);
            return;
          }
          this.setClientId(val);
          this.showToast('บันทึก Client ID เรียบร้อยแล้ว! กำลังเชื่อมต่อ...', 2000);
          this.initGisTokenClient();
          this.render();
        });
      }

      // Login Button
      const loginBtn = document.getElementById('btn-cr-login');
      if (loginBtn) {
        loginBtn.addEventListener('click', () => this.requestLogin());
      }

      // Logout / Switch Account
      const logoutBtn = document.getElementById('btn-cr-logout');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => this.logout());
      }

      // Settings Button (to re-edit Client ID)
      const settingsBtn = document.getElementById('btn-cr-settings');
      if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
          this.showView('setup');
        });
      }

      // Back to Courses button
      const backCoursesBtn = document.getElementById('btn-cr-back-courses');
      if (backCoursesBtn) {
        backCoursesBtn.addEventListener('click', () => {
          this.showView('courses');
        });
      }

      // Tab switcher inside modal
      const tabCourses = document.getElementById('tab-cr-courses');
      const tabLink = document.getElementById('tab-cr-link');
      if (tabCourses && tabLink) {
        tabCourses.addEventListener('click', () => {
          tabCourses.classList.add('active');
          tabLink.classList.remove('active');
          if (this.currentCourse) {
            this.showView('materials');
          } else {
            this.showView('courses');
          }
        });

        tabLink.addEventListener('click', () => {
          tabLink.classList.add('active');
          tabCourses.classList.remove('active');
          this.showView('link');
        });
      }

      // Direct Link / File ID Import
      const btnLinkImport = document.getElementById('btn-cr-import-by-link');
      if (btnLinkImport) {
        btnLinkImport.addEventListener('click', () => this.handleDirectLinkImport());
      }
    }

    setClientId(id) {
      this.clientId = id.trim();
      localStorage.setItem('farmnotes_google_client_id', this.clientId);
      this.tokenClient = null;
    }

    initGisTokenClient() {
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        return false;
      }
      if (!this.clientId) return false;

      try {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: [
            'https://www.googleapis.com/auth/classroom.courses.readonly',
            'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
            'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
          ].join(' '),
          callback: (tokenResponse) => {
            if (tokenResponse.error) {
              console.warn('GIS Token Error:', tokenResponse);
              if (tokenResponse.error !== 'silent_login_failed' && tokenResponse.error !== 'interaction_required') {
                this.showToast('การเข้าสู่ระบบไม่สำเร็จ: ' + tokenResponse.error, 3500);
              }
              return;
            }
            this.accessToken = tokenResponse.access_token;
            this.tokenExpiresAt = Date.now() + (parseInt(tokenResponse.expires_in, 10) || 3600) * 1000;
            localStorage.setItem('farmnotes_google_access_token', this.accessToken);
            localStorage.setItem('farmnotes_google_token_expires_at', this.tokenExpiresAt.toString());
            this.fetchUserProfile();
            this.loadCourses(true);
          }
        });
        return true;
      } catch (err) {
        console.error('Failed to init GIS token client:', err);
        return false;
      }
    }

    trySilentRefresh() {
      if (!this.clientId) return;
      if (!this.tokenClient) {
        this.initGisTokenClient();
      }
      if (this.tokenClient) {
        try {
          const req = { prompt: '' };
          if (this.currentUser && this.currentUser.email) {
            req.hint = this.currentUser.email;
          }
          this.tokenClient.requestAccessToken(req);
        } catch (e) {
          console.warn('Silent refresh error:', e);
        }
      }
    }

    open() {
      if (!this.modal) return;
      this.modal.classList.remove('hidden');
      this.render();
    }

    close() {
      if (!this.modal) return;
      this.modal.classList.add('hidden');
    }

    showView(viewName) {
      if (!this.setupView || !this.coursesView || !this.materialsView || !this.linkImportView) return;

      this.setupView.classList.add('hidden');
      this.coursesView.classList.add('hidden');
      this.materialsView.classList.add('hidden');
      this.linkImportView.classList.add('hidden');

      if (viewName === 'setup') this.setupView.classList.remove('hidden');
      if (viewName === 'courses') this.coursesView.classList.remove('hidden');
      if (viewName === 'materials') this.materialsView.classList.remove('hidden');
      if (viewName === 'link') this.linkImportView.classList.remove('hidden');
    }

    render() {
      if (!this.clientId) {
        const input = document.getElementById('cr-client-id-input');
        if (input) input.value = '';
        this.showView('setup');
        return;
      }

      const isTokenValid = this.accessToken && Date.now() < this.tokenExpiresAt;

      // If token expired or expiring soon, auto silent refresh
      if (!isTokenValid && this.currentUser) {
        this.trySilentRefresh();
      }

      if (!isTokenValid && !this.currentUser) {
        // Not logged in at all
        this.updateAccountBadge(null);
        this.showView('courses');
        this.renderLoggedOutState();
        return;
      }

      // Logged in (active or using cached session with background refresh)
      this.updateAccountBadge(this.currentUser);
      if (this.currentCourse) {
        this.showView('materials');
      } else {
        this.showView('courses');
        if (this.coursesCache && this.coursesCache.length > 0) {
          this.renderCourses(this.coursesCache);
          if (isTokenValid) {
            this.loadCourses(true); // background silent sync
          }
        } else if (isTokenValid) {
          this.loadCourses();
        } else {
          this.renderLoggedOutState();
        }
      }
    }

    updateAccountBadge(user) {
      if (!this.accountBanner) return;
      if (user) {
        this.accountBanner.innerHTML = `
          <div class="cr-user-badge">
            <img class="cr-user-avatar" src="${user.picture || 'icon-192.png'}" alt="Avatar">
            <div class="cr-user-info">
              <span class="cr-user-name">${this.escapeHtml(user.name || 'นักเรียน')}</span>
              <span class="cr-user-email">${this.escapeHtml(user.email || '')}</span>
            </div>
            <button class="btn-cr-pill-danger" id="btn-cr-logout" title="ออกจากระบบ">
              <i class="fa-solid fa-arrow-right-from-bracket"></i>
            </button>
            <button class="btn-cr-pill" id="btn-cr-settings" title="แก้ไขการตั้งค่า Client ID">
              <i class="fa-solid fa-gear"></i>
            </button>
          </div>
        `;
        const loBtn = this.accountBanner.querySelector('#btn-cr-logout');
        if (loBtn) loBtn.addEventListener('click', () => this.logout());
        const setBtn = this.accountBanner.querySelector('#btn-cr-settings');
        if (setBtn) setBtn.addEventListener('click', () => this.showView('setup'));
      } else {
        this.accountBanner.innerHTML = `
          <div class="cr-user-badge not-logged-in">
            <span><i class="fa-solid fa-circle-info"></i> ยังไม่ได้เชื่อมต่อกับบัญชี Google</span>
            <button class="btn-cr-pill" id="btn-cr-settings" title="แก้ไขการตั้งค่า Client ID">
              <i class="fa-solid fa-gear"></i> ตั้งค่า
            </button>
          </div>
        `;
        const setBtn = this.accountBanner.querySelector('#btn-cr-settings');
        if (setBtn) setBtn.addEventListener('click', () => this.showView('setup'));
      }
    }

    renderLoggedOutState() {
      if (!this.coursesListEl) return;
      this.coursesListEl.innerHTML = `
        <div class="cr-empty-state">
          <div class="cr-empty-icon" style="color: #0F9D58;">
            <i class="fa-solid fa-graduation-cap fa-2x"></i>
          </div>
          <h3>เข้าสู่ระบบ Google Classroom</h3>
          <p>เข้าสู่ระบบด้วยบัญชี Google ของโรงเรียนเพื่อดึงรายชื่อวิชาและชีทเรียนอัตโนมัติ</p>
          <button class="btn-primary cr-big-login-btn" id="btn-cr-login-action">
            <i class="fa-brands fa-google"></i> เข้าสู่ระบบด้วย Google
          </button>
        </div>
      `;
      const btn = this.coursesListEl.querySelector('#btn-cr-login-action');
      if (btn) {
        btn.addEventListener('click', () => this.requestLogin());
      }
    }

    requestLogin(forceSelect = false) {
      if (!this.clientId) {
        this.showView('setup');
        return;
      }
      if (!this.tokenClient) {
        const ok = this.initGisTokenClient();
        if (!ok) {
          this.showToast('กำลังโหลด Google Identity SDK... กรุณาลองใหม่อีกครั้ง', 2500);
          return;
        }
      }
      const req = { prompt: forceSelect ? 'select_account' : '' };
      if (this.currentUser && this.currentUser.email && !forceSelect) {
        req.hint = this.currentUser.email;
      }
      this.tokenClient.requestAccessToken(req);
    }

    logout() {
      if (this.accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
        try {
          window.google.accounts.oauth2.revoke(this.accessToken, () => {});
        } catch (e) {}
      }
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      this.currentUser = null;
      this.coursesCache = [];
      this.currentCourse = null;
      localStorage.removeItem('farmnotes_google_access_token');
      localStorage.removeItem('farmnotes_google_token_expires_at');
      localStorage.removeItem('farmnotes_google_user_profile');
      localStorage.removeItem('farmnotes_google_courses_cache');
      this.showToast('ออกจากระบบเรียบร้อยแล้ว', 2000);
      this.render();
    }

    async fetchUserProfile() {
      if (!this.accessToken) return;
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
        if (res.ok) {
          this.currentUser = await res.json();
          localStorage.setItem('farmnotes_google_user_profile', JSON.stringify(this.currentUser));
          this.updateAccountBadge(this.currentUser);
        }
      } catch (e) {
        console.warn('Failed to fetch userinfo:', e);
      }
    }

    async loadCourses(silent = false) {
      if (!this.accessToken) {
        if (!silent) this.renderLoggedOutState();
        return;
      }

      if (!silent && this.coursesListEl) {
        this.coursesListEl.innerHTML = `
          <div class="cr-loading-state">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
            <p>กำลังดึงข้อมูลวิชาเรียนทั้งหมดจาก Google Classroom...</p>
          </div>
        `;
      }

      try {
        const res = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        if (!res.ok) {
          if (res.status === 401) {
            this.accessToken = null;
            localStorage.removeItem('farmnotes_google_access_token');
            this.trySilentRefresh();
            return;
          }
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        this.coursesCache = data.courses || [];
        localStorage.setItem('farmnotes_google_courses_cache', JSON.stringify(this.coursesCache));
        this.renderCourses(this.coursesCache);
      } catch (err) {
        console.error('Error loading courses:', err);
        if (!silent && this.coursesListEl) {
          this.coursesListEl.innerHTML = `
            <div class="cr-error-state">
              <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
              <h3>ไม่สามารถโหลดรายชื่อวิชาได้</h3>
              <p>${this.escapeHtml(err.message)}</p>
              <button class="btn-secondary" id="btn-cr-retry-courses">
                <i class="fa-solid fa-rotate-right"></i> ลองใหม่
              </button>
            </div>
          `;
          const rBtn = this.coursesListEl.querySelector('#btn-cr-retry-courses');
          if (rBtn) rBtn.addEventListener('click', () => this.loadCourses());
        }
      }
    }

    renderCourses(courses) {
      if (!this.coursesListEl) return;

      if (!courses || courses.length === 0) {
        this.coursesListEl.innerHTML = `
          <div class="cr-empty-state">
            <i class="fa-solid fa-folder-open fa-2x" style="color: #8E8E93;"></i>
            <h3>ไม่พบวิชาเรียนที่กำลังเปิดอยู่</h3>
            <p>ไม่มีรายวิชาที่สถานะ ACTIVE ในบัญชีนี้</p>
          </div>
        `;
        return;
      }

      const colors = ['#137333', '#1A73E8', '#E37400', '#A142F4', '#D93025', '#129EAF', '#5F6368'];

      let html = '<div class="cr-course-grid">';
      courses.forEach((c, idx) => {
        const color = colors[idx % colors.length];
        const section = c.section ? `<span class="cr-card-sec">${this.escapeHtml(c.section)}</span>` : '';
        const room = c.room ? ` • ห้อง ${this.escapeHtml(c.room)}` : '';

        html += `
          <div class="cr-course-card" data-course-id="${c.id}">
            <div class="cr-card-top" style="background: ${color};">
              <h4 class="cr-card-title">${this.escapeHtml(c.name)}</h4>
              <div class="cr-card-sub">${section}${room}</div>
            </div>
            <div class="cr-card-bottom">
              <div class="cr-card-action">
                <span>เปิดดูชีทและใบงาน</span>
                <i class="fa-solid fa-chevron-right"></i>
              </div>
            </div>
          </div>
        `;
      });
      html += '</div>';

      this.coursesListEl.innerHTML = html;

      // Attach click events
      this.coursesListEl.querySelectorAll('.cr-course-card').forEach(card => {
        card.addEventListener('click', () => {
          const cId = card.dataset.courseId;
          const course = this.coursesCache.find(x => x.id === cId);
          if (course) {
            this.openCourse(course);
          }
        });
      });
    }

    async openCourse(course) {
      this.currentCourse = course;
      if (this.courseHeaderTitle) this.courseHeaderTitle.innerText = course.name;
      if (this.courseHeaderSubtitle) {
        this.courseHeaderSubtitle.innerText = (course.section || '') + (course.room ? ` • ห้อง ${course.room}` : '');
      }

      this.showView('materials');

      if (this.materialsListEl) {
        this.materialsListEl.innerHTML = `
          <div class="cr-loading-state">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
            <p>กำลังค้นหาชีทเรียนและเอกสาร PDF ในวิชา ${this.escapeHtml(course.name)}...</p>
          </div>
        `;
      }

      try {
        // Fetch both coursework (assignments) and courseworkmaterials (announcements/materials)
        const [materialsRes, courseworkRes] = await Promise.all([
          fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWorkMaterials`, {
            headers: { Authorization: `Bearer ${this.accessToken}` }
          }).then(r => r.ok ? r.json() : { courseWorkMaterial: [] }).catch(() => ({ courseWorkMaterial: [] })),
          fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`, {
            headers: { Authorization: `Bearer ${this.accessToken}` }
          }).then(r => r.ok ? r.json() : { courseWork: [] }).catch(() => ({ courseWork: [] }))
        ]);

        const allItems = [];

        // Parse Materials
        if (materialsRes.courseWorkMaterial) {
          materialsRes.courseWorkMaterial.forEach(item => {
            allItems.push({
              type: 'material',
              title: item.title,
              description: item.description,
              updateTime: item.updateTime || item.creationTime,
              materials: item.materials || []
            });
          });
        }

        // Parse Coursework / Assignments
        if (courseworkRes.courseWork) {
          courseworkRes.courseWork.forEach(item => {
            allItems.push({
              type: 'assignment',
              title: item.title,
              description: item.description,
              updateTime: item.updateTime || item.creationTime,
              materials: item.materials || []
            });
          });
        }

        // Sort latest first
        allItems.sort((a, b) => new Date(b.updateTime) - new Date(a.updateTime));

        this.renderCourseMaterials(allItems);
      } catch (err) {
        console.error('Error fetching materials:', err);
        if (this.materialsListEl) {
          this.materialsListEl.innerHTML = `
            <div class="cr-error-state">
              <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
              <h3>ไม่สามารถโหลดชีทเรียนได้</h3>
              <p>${this.escapeHtml(err.message)}</p>
              <button class="btn-secondary" id="btn-cr-retry-materials">
                <i class="fa-solid fa-rotate-right"></i> ลองใหม่
              </button>
            </div>
          `;
          const rBtn = this.materialsListEl.querySelector('#btn-cr-retry-materials');
          if (rBtn) rBtn.addEventListener('click', () => this.openCourse(course));
        }
      }
    }

    renderCourseMaterials(items) {
      if (!this.materialsListEl) return;

      // Extract all PDF files
      const pdfFiles = [];
      items.forEach(item => {
        if (item.materials && Array.isArray(item.materials)) {
          item.materials.forEach(m => {
            if (m.driveFile && m.driveFile.driveFile) {
              const df = m.driveFile.driveFile;
              const title = df.title || 'เอกสารไม่มีชื่อ';
              // Check if PDF or slide/doc
              const isPdf = title.toLowerCase().endsWith('.pdf') || (df.alternateLink && df.alternateLink.includes('pdf'));
              pdfFiles.push({
                fileId: df.id,
                title: title,
                isPdf: isPdf,
                postTitle: item.title,
                type: item.type,
                date: item.updateTime,
                thumb: df.thumbnailUrl || ''
              });
            }
          });
        }
      });

      if (pdfFiles.length === 0) {
        this.materialsListEl.innerHTML = `
          <div class="cr-empty-state">
            <i class="fa-solid fa-file-circle-question fa-2x" style="color: #8E8E93;"></i>
            <h3>ไม่พบไฟล์เอกสารในวิชานี้</h3>
            <p>ครูผู้สอนอาจจะยังไม่ได้แนบไฟล์ หรือโพสต์เอกสารไว้ในช่องทางอื่น</p>
          </div>
        `;
        return;
      }

      let html = '<div class="cr-materials-grid">';
      pdfFiles.forEach(file => {
        const dateStr = file.date ? new Date(file.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
        const tag = file.type === 'assignment' ? '<span class="cr-tag assignment">การบ้าน</span>' : '<span class="cr-tag material">ชีทเรียน</span>';

        html += `
          <div class="cr-file-card">
            <div class="cr-file-icon">
              <i class="fa-solid fa-file-pdf"></i>
            </div>
            <div class="cr-file-info">
              <div class="cr-file-meta">${tag} <span class="cr-file-date">${dateStr}</span></div>
              <h5 class="cr-file-title" title="${this.escapeHtml(file.title)}">${this.escapeHtml(file.title)}</h5>
              <p class="cr-file-post">โพสต์: ${this.escapeHtml(file.postTitle)}</p>
            </div>
            <button class="btn-primary cr-import-file-btn" data-file-id="${file.fileId}" data-file-name="${this.escapeHtml(file.title)}">
              <i class="fa-solid fa-file-import"></i> นำเข้าทันที
            </button>
          </div>
        `;
      });
      html += '</div>';

      this.materialsListEl.innerHTML = html;

      // Attach Import Event
      this.materialsListEl.querySelectorAll('.cr-import-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fId = btn.dataset.fileId;
          const fName = btn.dataset.fileName;
          this.importDrivePdf(fId, fName, btn);
        });
      });
    }

    async importDrivePdf(fileId, fileName, btnEl = null) {
      if (!this.accessToken) {
        this.showToast('กรุณาเข้าสู่ระบบ Google ก่อนนำเข้าไฟล์', 2500);
        this.requestLogin();
        return;
      }

      const origHtml = btnEl ? btnEl.innerHTML : '';
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังดาวน์โหลด...';
      }

      try {
        // Step 1: Download binary stream directly via Google Drive API with OAuth Bearer Token
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const res = await fetch(downloadUrl, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`
          }
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status}): ${errText.slice(0, 100)}`);
        }

        if (btnEl) {
          btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังแปลงเป็นสมุด...';
        }

        const blob = await res.blob();
        const cleanName = fileName || `Classroom_${Date.now()}.pdf`;

        // Create File object compatible with PDFEngine.importPDF
        const fileObj = new File([blob], cleanName, { type: 'application/pdf' });

        // Step 2: Feed directly into FarmNotes PDF Engine!
        const nb = await window.PDFEngine.importPDF(fileObj, window.Storage, null, (cur, total) => {
          if (btnEl) {
            btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> แปลงหน้า (${cur}/${total})...`;
          }
        });

        // Step 3: Success! Close modal and open newly created notebook immediately!
        this.close();
        if (this.app && typeof this.app.openNotebook === 'function') {
          this.app.openNotebook(nb.id);
        } else if (this.app && this.app.editor) {
          this.app.editor.openNotebook(nb.id);
        }

        if (window.CustomDialog && window.CustomDialog.toast) {
          window.CustomDialog.toast(`นำเข้าชีท "${cleanName}" สำเร็จเรียบร้อย!`, 3000);
        }
      } catch (err) {
        console.error('Failed to import PDF from Google Drive:', err);
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.innerHTML = origHtml;
        }
        if (window.CustomDialog && window.CustomDialog.alert) {
          window.CustomDialog.alert('เกิดข้อผิดพลาดในการนำเข้า', err.message);
        } else {
          alert('เกิดข้อผิดพลาดในการนำเข้า: ' + err.message);
        }
      }
    }

    async handleDirectLinkImport() {
      const input = document.getElementById('cr-direct-link-input');
      const url = input ? input.value.trim() : '';
      if (!url) {
        this.showToast('กรุณาวางลิงก์ Google Drive หรือ Classroom', 2500);
        return;
      }

      let fileId = '';
      const match1 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const match2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);

      if (match1 && match1[1]) {
        fileId = match1[1];
      } else if (match2 && match2[1]) {
        fileId = match2[1];
      } else if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) {
        fileId = url;
      }

      if (!fileId) {
        this.showToast('ไม่สามารถระบุรหัสไฟล์จากลิงก์ที่วางได้ กรุณาตรวจสอบลิงก์', 3500);
        return;
      }

      const btn = document.getElementById('btn-cr-import-by-link');
      await this.importDrivePdf(fileId, 'Classroom_Sheet.pdf', btn);
    }

    showToast(msg, duration = 2500) {
      if (window.CustomDialog && window.CustomDialog.toast) {
        window.CustomDialog.toast(msg, duration);
      } else {
        console.log('[ClassroomExplorer]', msg);
      }
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  }

  // Export globally
  window.ClassroomExplorer = new ClassroomExplorer();

})();
