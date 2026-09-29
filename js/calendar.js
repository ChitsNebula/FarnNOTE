/**
 * FarmNotes — LifeCalendar Engine (v2.14.0)
 * Integrated Life Calendar, Tasks, Deadlines, Reading Planner & Overdue Backlog
 * Bound with Google Account & 2-Way Google Calendar Synchronization
 */

(function () {
  'use strict';

  class LifeCalendarEngine {
    constructor() {
      this.app = null;
      this.currentUser = null;
      this.accessToken = null;
      this.userId = null;

      // State
      this.currentDate = new Date();
      this.currentView = 'month'; // 'month' | 'week' | 'day'
      this.activeTab = 'calendar'; // 'calendar' | 'todo' | 'deadline' | 'reading' | 'backlog'
      this.todoFilter = 'all'; // 'all' | 'pending' | 'done' | 'high'
      this.isSyncing = false;
      this.sidePanelCollapsed = false;

      // Data caches
      this.events = [];
      this.readingPlans = [];
      this.reminders = [];

      // DOM root
      this.container = null;
      this.notificationInterval = null;
    }

    async init(app) {
      this.app = app;
      this.container = document.getElementById('calendar-root');

      // Listen for Google Auth changes from classroom.js
      window.addEventListener('farmnotes_google_auth_changed', (e) => {
        this.handleAuthChange(e.detail?.user, e.detail?.token);
      });

      // Check current login status
      this.checkCurrentAuth();

      // Start periodic notification checker
      this.startNotificationDaemon();
    }

    checkCurrentAuth() {
      const explorer = window.ClassroomExplorer;
      if (explorer && explorer.currentUser && explorer.accessToken) {
        this.currentUser = explorer.currentUser;
        this.accessToken = explorer.accessToken;
        this.userId = this.currentUser.sub || this.currentUser.email || 'default_user';
        return true;
      }
      // Check localStorage directly as fallback
      try {
        const savedUser = localStorage.getItem('farmnotes_google_user_profile');
        const token = localStorage.getItem('farmnotes_google_access_token');
        if (savedUser && token) {
          this.currentUser = JSON.parse(savedUser);
          this.accessToken = token;
          this.userId = this.currentUser.sub || this.currentUser.email || 'default_user';
          return true;
        }
      } catch (e) {}

      this.currentUser = null;
      this.accessToken = null;
      this.userId = null;
      return false;
    }

    handleAuthChange(user, token) {
      if (user && token) {
        this.currentUser = user;
        this.accessToken = token;
        this.userId = user.sub || user.email || 'default_user';
        this.loadDataAndRender();
      } else {
        this.currentUser = null;
        this.accessToken = null;
        this.userId = null;
        this.events = [];
        this.readingPlans = [];
        this.reminders = [];
        this.render();
      }
    }

    async show() {
      if (this.checkCurrentAuth()) {
        await this.loadDataAndRender();
        // Trigger silent background sync from Google Calendar
        this.syncFromGoogleCalendar(true);
      } else {
        this.render();
      }
    }

    async loadDataAndRender() {
      if (!this.userId) {
        this.render();
        return;
      }

      try {
        if (window.Storage) {
          this.events = (await window.Storage.getCalendarEvents(this.userId)) || [];
          this.readingPlans = (await window.Storage.getReadingPlans(this.userId)) || [];
          this.reminders = (await window.Storage.getReminders(this.userId)) || [];
        }
      } catch (err) {
        console.error('Failed to load LifeCalendar data:', err);
      }

      // Check overdue tasks and migrate to backlog
      this.migrateOverdueToBacklog();

      this.render();
    }

    migrateOverdueToBacklog() {
      const todayStr = this.formatDateIso(new Date());
      let modified = false;

      this.events.forEach(ev => {
        if ((ev.type === 'todo' || ev.type === 'deadline') && ev.status !== 'done' && ev.date < todayStr) {
          if (!ev.isOverdueMigrated) {
            ev.isOverdueMigrated = true;
            modified = true;
            // Add to reminders as backlog
            const backlogItem = {
              id: 'rem_overdue_' + ev.id,
              userId: this.userId,
              text: `[งานเลยกำหนด] ${ev.title} (${ev.date})`,
              isPinned: true,
              dueDate: ev.date,
              isBacklog: true,
              sourceEventId: ev.id
            };
            this.reminders.push(backlogItem);
            if (window.Storage) window.Storage.saveReminder(backlogItem);
          }
        }
      });

      if (modified) {
        this.updateBadgeCounts();
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RENDER DISPATCHER
    // ──────────────────────────────────────────────────────────────────────────
    render() {
      if (!this.container) return;

      // 1. Check if logged in with Google
      if (!this.currentUser || !this.accessToken) {
        this.renderLoginWall();
        return;
      }

      // 2. Render Full LifeCalendar Interface
      this.container.innerHTML = `
        <header class="cal-nav-header">
          <div class="cal-header-left">
            <button class="cal-btn-back" id="cal-btn-back-lib" title="กลับไปหน้าสมุดโน้ต">
              <i class="fa-solid fa-arrow-left"></i>
              <span>สมุดโน้ต</span>
            </button>
            <div class="cal-header-title-wrap">
              <h2 class="cal-header-title"><i class="fa-solid fa-calendar-check" style="color: var(--cal-blue); margin-right: 6px;"></i>ปฏิทินชีวิต</h2>
            </div>
            <div class="cal-nav-arrows">
              <button class="cal-arrow-btn" id="cal-prev-btn" title="ก่อนหน้า"><i class="fa-solid fa-chevron-left"></i></button>
              <button class="cal-btn-today" id="cal-today-btn">วันนี้</button>
              <button class="cal-arrow-btn" id="cal-next-btn" title="ถัดไป"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <span class="cal-current-label" id="cal-period-label">${this.getPeriodLabel()}</span>
          </div>

          <div class="cal-nav-tabs">
            <button class="cal-tab-btn ${this.activeTab === 'calendar' ? 'active' : ''}" data-tab="calendar">
              <i class="fa-regular fa-calendar"></i>
              <span>ปฏิทิน</span>
            </button>
            <button class="cal-tab-btn ${this.activeTab === 'todo' ? 'active' : ''}" data-tab="todo">
              <i class="fa-solid fa-list-check"></i>
              <span>สิ่งที่ต้องทำ</span>
              <span class="cal-tab-badge" id="cal-badge-todo">${this.getPendingTodoCount()}</span>
            </button>
            <button class="cal-tab-btn ${this.activeTab === 'deadline' ? 'active' : ''}" data-tab="deadline">
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span>สิ่งที่ต้องส่ง</span>
              <span class="cal-tab-badge ${this.getUrgentDeadlineCount() > 0 ? 'red' : ''}" id="cal-badge-deadline">${this.getUrgentDeadlineCount()}</span>
            </button>
            <button class="cal-tab-btn ${this.activeTab === 'reading' ? 'active' : ''}" data-tab="reading">
              <i class="fa-solid fa-book-bookmark"></i>
              <span>อ่านหนังสือ</span>
              <span class="cal-tab-badge" id="cal-badge-reading">${this.readingPlans.length}</span>
            </button>
            <button class="cal-tab-btn ${this.activeTab === 'backlog' ? 'active' : ''}" data-tab="backlog">
              <i class="fa-solid fa-note-sticky"></i>
              <span>งานค้าง & เตือน</span>
              <span class="cal-tab-badge" id="cal-badge-backlog">${this.reminders.length}</span>
            </button>
          </div>

          <div class="cal-header-right">
            ${this.activeTab === 'calendar' ? `
            <div class="cal-view-switch">
              <button class="cal-view-btn ${this.currentView === 'month' ? 'active' : ''}" data-view="month">เดือน</button>
              <button class="cal-view-btn ${this.currentView === 'week' ? 'active' : ''}" data-view="week">สัปดาห์</button>
              <button class="cal-view-btn ${this.currentView === 'day' ? 'active' : ''}" data-view="day">วัน</button>
            </div>
            ` : ''}

            <button class="cal-btn-sync ${this.isSyncing ? 'spinning' : ''}" id="cal-btn-sync" title="ซิงค์กับ Google Calendar">
              <i class="fa-solid fa-arrows-rotate"></i>
              <span>ซิงค์</span>
            </button>

            <button class="cal-btn-add" id="cal-btn-quick-add">
              <i class="fa-solid fa-plus"></i>
              <span>เพิ่ม</span>
            </button>

            <img class="cal-user-avatar" id="cal-user-avatar" src="${this.currentUser.picture || 'icon-192.png'}" title="${this.escapeHtml(this.currentUser.name || this.currentUser.email)} (คลิกเพื่อดูตัวเลือก)" alt="User">
          </div>
        </header>

        <div class="cal-main-layout">
          <main class="cal-content-area" id="cal-view-container">
            ${this.renderActiveTabContent()}
          </main>

          <aside class="cal-side-panel ${this.sidePanelCollapsed ? 'collapsed' : ''}" id="cal-side-panel">
            ${this.renderTodaySidePanel()}
          </aside>
        </div>
      `;

      this.bindHeaderEvents();
      this.bindTabEvents();
      this.updateBadgeCounts();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // LOGIN WALL
    // ──────────────────────────────────────────────────────────────────────────
    renderLoginWall() {
      const explorer = window.ClassroomExplorer;
      const hasClientId = explorer && explorer.clientId;

      this.container.innerHTML = `
        <div class="cal-login-wall">
          <div class="cal-login-card">
            <div class="cal-login-icon-box">
              <i class="fa-solid fa-calendar-check"></i>
            </div>
            <h2 class="cal-login-title">ปฏิทินตารางชีวิต FarmNotes</h2>
            <p class="cal-login-desc">
              ระบบวางแผนชีวิตประจำวัน ตารางสิ่งที่ต้องทำ สิ่งที่ต้องส่ง แผนอ่านหนังสือ และงานค้าง 
              ซิงค์เชื่อมต่ออัตโนมัติกับ <strong>Google Calendar</strong> ของคุณ
            </p>

            <button class="cal-btn-google-login" id="btn-cal-google-login">
              <svg class="cal-google-icon" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span>เข้าสู่ระบบด้วย Google</span>
            </button>

            <div class="cal-client-id-prompt">
              ${!hasClientId ? `
                <span>ยังไม่ได้ตั้งค่า Google Client ID? <a id="cal-link-open-setup">กดที่นี่เพื่อใส่ Client ID</a></span>
              ` : `
                <span>เข้าสู่ระบบเพื่อดูตารางชีวิตเฉพาะของคุณ</span>
              `}
            </div>

            <button class="cal-btn-back" id="cal-btn-back-from-wall" style="margin-top: 10px;">
              <i class="fa-solid fa-arrow-left"></i> กลับไปสมุดโน้ต
            </button>
          </div>
        </div>
      `;

      // Bind Login Wall Events
      document.getElementById('btn-cal-google-login')?.addEventListener('click', () => {
        if (window.ClassroomExplorer) {
          window.ClassroomExplorer.requestLogin(false);
        }
      });

      document.getElementById('cal-link-open-setup')?.addEventListener('click', () => {
        if (window.ClassroomExplorer) {
          window.ClassroomExplorer.open();
          window.ClassroomExplorer.showView('setup');
        }
      });

      document.getElementById('cal-btn-back-from-wall')?.addEventListener('click', () => {
        if (this.app) this.app.showLibrary();
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TAB DISPATCHER
    // ──────────────────────────────────────────────────────────────────────────
    renderActiveTabContent() {
      switch (this.activeTab) {
        case 'calendar':
          if (this.currentView === 'month') return this.renderMonthView();
          if (this.currentView === 'week') return this.renderWeekView();
          if (this.currentView === 'day') return this.renderDayView();
          return this.renderMonthView();
        case 'todo':
          return this.renderTodoPanel();
        case 'deadline':
          return this.renderDeadlinePanel();
        case 'reading':
          return this.renderReadingPanel();
        case 'backlog':
          return this.renderBacklogPanel();
        default:
          return this.renderMonthView();
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. MONTH VIEW
    // ──────────────────────────────────────────────────────────────────────────
    renderMonthView() {
      const year = this.currentDate.getFullYear();
      const month = this.currentDate.getMonth();

      const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      const todayIso = this.formatDateIso(new Date());

      // Expand recurring instances for this month
      const expandedEvents = this.getExpandedEventsForMonth(year, month);

      let gridHtml = '';

      // Previous month padding days
      for (let i = firstDayOfMonth - 1; i >= 0; i--) {
        const dayNum = daysInPrevMonth - i;
        const d = new Date(year, month - 1, dayNum);
        const iso = this.formatDateIso(d);
        gridHtml += this.renderDayCell(iso, dayNum, true, false, expandedEvents);
      }

      // Current month days
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const iso = this.formatDateIso(d);
        const isToday = iso === todayIso;
        gridHtml += this.renderDayCell(iso, day, false, isToday, expandedEvents);
      }

      // Next month padding days to fill 35 or 42 cells
      const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
      const nextMonthDays = totalCells - (firstDayOfMonth + daysInMonth);
      for (let day = 1; day <= nextMonthDays; day++) {
        const d = new Date(year, month + 1, day);
        const iso = this.formatDateIso(d);
        gridHtml += this.renderDayCell(iso, day, true, false, expandedEvents);
      }

      return `
        <div class="cal-month-container">
          <div class="cal-weekdays-row">
            <div class="weekend">อาทิตย์</div>
            <div>จันทร์</div>
            <div>อังคาร</div>
            <div>พุธ</div>
            <div>พฤหัสบดี</div>
            <div>ศุกร์</div>
            <div class="weekend">เสาร์</div>
          </div>
          <div class="cal-days-grid" id="cal-month-grid">
            ${gridHtml}
          </div>
        </div>
      `;
    }

    renderDayCell(dateIso, dayNum, isOtherMonth, isToday, allEvents) {
      const dayEvents = allEvents.filter(e => e.date === dateIso);

      let eventsHtml = '';
      dayEvents.slice(0, 4).forEach(e => {
        let typeClass = 'type-event';
        let icon = 'fa-regular fa-clock';
        if (e.type === 'todo') {
          typeClass = 'type-todo' + (e.status === 'done' ? ' done' : '');
          icon = 'fa-solid fa-check';
        } else if (e.type === 'deadline') {
          typeClass = 'type-deadline';
          icon = 'fa-solid fa-hourglass-half';
        } else if (e.type === 'reading') {
          typeClass = 'type-reading';
          icon = 'fa-solid fa-book';
        }

        eventsHtml += `
          <div class="cal-event-pill ${typeClass}" data-event-id="${e.id}" title="${this.escapeHtml(e.title)} (${e.time || 'ทั้งวัน'})">
            <i class="${icon}" style="font-size: 9px;"></i>
            <span>${this.escapeHtml(e.title)}</span>
          </div>
        `;
      });

      if (dayEvents.length > 4) {
        eventsHtml += `<div class="cal-event-pill" style="color: var(--cal-silver); background: transparent;">+ อีก ${dayEvents.length - 4} รายการ</div>`;
      }

      return `
        <div class="cal-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dateIso}">
          <div class="cal-day-header">
            <span class="cal-day-num">${dayNum}</span>
          </div>
          <div class="cal-events-list">
            ${eventsHtml}
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. WEEK & DAY VIEWS
    // ──────────────────────────────────────────────────────────────────────────
    renderWeekView() {
      const curr = new Date(this.currentDate);
      const dayOfWeek = curr.getDay(); // 0 = Sun
      const sunday = new Date(curr);
      sunday.setDate(curr.getDate() - dayOfWeek);

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(sunday);
        d.setDate(sunday.getDate() + i);
        days.push(d);
      }

      const todayIso = this.formatDateIso(new Date());

      let html = '<div class="cal-agenda-container">';
      days.forEach(d => {
        const iso = this.formatDateIso(d);
        const isToday = iso === todayIso;
        const dayEvents = this.getExpandedEventsForDate(iso);
        const thaiDays = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

        html += `
          <div class="cal-agenda-day-card ${isToday ? 'today' : ''}" data-date="${iso}">
            <div class="cal-agenda-day-title">
              <span><strong>${thaiDays[d.getDay()]}</strong> (${d.getDate()} ${this.getThaiMonthName(d.getMonth())})</span>
              ${isToday ? '<span class="cal-side-date-badge">วันนี้</span>' : ''}
            </div>
            <div class="cal-tasks-list">
              ${dayEvents.length === 0 ? '<div style="font-size: 13px; color: var(--cal-silver);">ไม่มีกิจกรรมหรือสิ่งที่ต้องทำ</div>' : ''}
              ${dayEvents.map(e => `
                <div class="cal-task-card ${e.type === 'deadline' ? 'priority-high' : ''}">
                  <div class="cal-task-left">
                    <i class="${e.type === 'deadline' ? 'fa-solid fa-hourglass-half text-red' : (e.type === 'todo' ? 'fa-solid fa-check' : 'fa-regular fa-clock')}" style="color: ${e.color || 'var(--cal-blue)'};"></i>
                    <span class="cal-task-text ${e.status === 'done' ? 'done' : ''}">${this.escapeHtml(e.title)}</span>
                  </div>
                  <div class="cal-task-right">
                    <span class="cal-task-date-tag">${e.time || 'ทั้งวัน'}</span>
                    <button class="cal-btn-icon-danger" data-action="delete-event" data-id="${e.id}"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });
      html += '</div>';
      return html;
    }

    renderDayView() {
      const iso = this.formatDateIso(this.currentDate);
      const dayEvents = this.getExpandedEventsForDate(iso);
      const d = this.currentDate;
      const thaiDays = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];

      return `
        <div class="cal-agenda-container" style="max-width: 800px; margin: 0 auto; width: 100%;">
          <div class="cal-agenda-day-card today">
            <div class="cal-agenda-day-title">
              <span><strong>${thaiDays[d.getDay()]}ที่ ${d.getDate()} ${this.getThaiMonthName(d.getMonth())} ${d.getFullYear() + 543}</strong></span>
              <button class="cal-btn-add" id="btn-day-add-event" data-date="${iso}"><i class="fa-solid fa-plus"></i> เพิ่มรายการวันนี้</button>
            </div>
            <div class="cal-tasks-list" style="margin-top: 14px;">
              ${dayEvents.length === 0 ? '<div style="font-size: 14px; color: var(--cal-silver); padding: 20px 0; text-align: center;">ไม่มีกิจกรรมหรือตารางงานในวันนี้</div>' : ''}
              ${dayEvents.map(e => `
                <div class="cal-task-card ${e.priority ? 'priority-' + e.priority : ''}">
                  <div class="cal-task-left">
                    <span class="cal-checkbox ${e.status === 'done' ? 'checked' : ''}" data-action="toggle-todo" data-id="${e.id}">
                      ${e.status === 'done' ? '<i class="fa-solid fa-check"></i>' : ''}
                    </span>
                    <div>
                      <div class="cal-task-text ${e.status === 'done' ? 'done' : ''}">${this.escapeHtml(e.title)}</div>
                      ${e.notes ? `<div style="font-size: 12px; color: var(--cal-silver);">${this.escapeHtml(e.notes)}</div>` : ''}
                    </div>
                  </div>
                  <div class="cal-task-right">
                    <span class="cal-task-date-tag">${e.time || 'ทั้งวัน'}</span>
                    <button class="cal-btn-icon-danger" data-action="delete-event" data-id="${e.id}"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. TO-DO PANEL
    // ──────────────────────────────────────────────────────────────────────────
    renderTodoPanel() {
      const todayIso = this.formatDateIso(new Date());

      // Filter tasks
      let list = this.events.filter(e => e.type === 'todo');
      if (this.todoFilter === 'pending') list = list.filter(e => e.status !== 'done');
      if (this.todoFilter === 'done') list = list.filter(e => e.status === 'done');
      if (this.todoFilter === 'high') list = list.filter(e => e.priority === 'high');

      return `
        <div class="cal-panel-wrap">
          <div class="cal-task-input-bar">
            <input type="text" id="todo-input-title" placeholder="สิ่งที่ต้องทำใหม่... (เช่น ทำการบ้านบทที่ 3)" autocomplete="off">
            <select id="todo-input-priority">
              <option value="medium">ความสำคัญ: ปานกลาง</option>
              <option value="high">ความสำคัญ: สูงมาก 🚨</option>
              <option value="low">ความสำคัญ: ทั่วไป</option>
            </select>
            <select id="todo-input-category">
              <option value="study">วิชาการ / การเรียน</option>
              <option value="work">งาน / โปรเจกต์</option>
              <option value="personal">ส่วนตัว</option>
            </select>
            <input type="date" id="todo-input-date" value="${todayIso}">
            <button class="cal-btn-add" id="btn-add-todo"><i class="fa-solid fa-plus"></i> เพิ่มงาน</button>
          </div>

          <div class="cal-task-filter-chips">
            <button class="cal-chip ${this.todoFilter === 'all' ? 'active' : ''}" data-filter="all">ทั้งหมด (${this.events.filter(e => e.type === 'todo').length})</button>
            <button class="cal-chip ${this.todoFilter === 'pending' ? 'active' : ''}" data-filter="pending">ยังไม่เสร็จ (${this.events.filter(e => e.type === 'todo' && e.status !== 'done').length})</button>
            <button class="cal-chip ${this.todoFilter === 'high' ? 'active' : ''}" data-filter="high">ด่วนที่สุด (${this.events.filter(e => e.type === 'todo' && e.priority === 'high').length})</button>
            <button class="cal-chip ${this.todoFilter === 'done' ? 'active' : ''}" data-filter="done">เสร็จแล้ว (${this.events.filter(e => e.type === 'todo' && e.status === 'done').length})</button>
          </div>

          <div class="cal-tasks-list">
            ${list.length === 0 ? '<div style="text-align: center; color: var(--cal-silver); padding: 40px;">ไม่มีรายการงานในหมวดนี้ 🎉</div>' : ''}
            ${list.map(t => `
              <div class="cal-task-card priority-${t.priority || 'medium'}">
                <div class="cal-task-left">
                  <span class="cal-checkbox ${t.status === 'done' ? 'checked' : ''}" data-action="toggle-todo" data-id="${t.id}">
                    ${t.status === 'done' ? '<i class="fa-solid fa-check"></i>' : ''}
                  </span>
                  <div>
                    <span class="cal-task-text ${t.status === 'done' ? 'done' : ''}">${this.escapeHtml(t.title)}</span>
                    <span style="font-size: 11px; color: var(--cal-silver); margin-left: 8px;">[${this.getCategoryLabel(t.category)}]</span>
                  </div>
                </div>
                <div class="cal-task-right">
                  <span class="cal-task-date-tag">${t.date}</span>
                  <button class="cal-btn-icon-danger" data-action="delete-event" data-id="${t.id}"><i class="fa-solid fa-trash-can"></i></button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. DEADLINE TRACKER PANEL
    // ──────────────────────────────────────────────────────────────────────────
    renderDeadlinePanel() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const deadlines = this.events.filter(e => e.type === 'deadline');
      deadlines.sort((a, b) => new Date(a.date) - new Date(b.date));

      return `
        <div class="cal-panel-wrap">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 style="margin: 0; font-size: 18px; color: var(--cal-carbon);">สิ่งที่ต้องส่ง / กำหนดส่ง (Deadlines)</h3>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--cal-silver);">ติดตามงานที่มีเดดไลน์ใกล้หมด พร้อมระบบนับถอยหลัง</p>
            </div>
            <button class="cal-btn-add" id="btn-add-deadline-modal"><i class="fa-solid fa-plus"></i> เพิ่มกำหนดส่ง</button>
          </div>

          <div class="cal-deadline-grid">
            ${deadlines.length === 0 ? '<div style="grid-column: 1/-1; text-align: center; color: var(--cal-silver); padding: 40px;">ไม่มีงานที่ต้องส่งในขณะนี้ สบายใจได้! 😎</div>' : ''}
            ${deadlines.map(d => {
              const target = new Date(d.date);
              target.setHours(0, 0, 0, 0);
              const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));

              let badgeClass = 'normal';
              let badgeText = `เหลืออีก ${diffDays} วัน`;

              if (d.status === 'done') {
                badgeClass = 'done';
                badgeText = 'ส่งเรียบร้อยแล้ว ✓';
              } else if (diffDays < 0) {
                badgeClass = 'overdue';
                badgeText = `เกินกำหนด ${Math.abs(diffDays)} วัน!`;
              } else if (diffDays === 0) {
                badgeClass = 'urgent';
                badgeText = 'ส่งภายในวันนี้!';
              } else if (diffDays <= 3) {
                badgeClass = 'urgent';
                badgeText = `ด่วน! เหลืออีก ${diffDays} วัน`;
              }

              return `
                <div class="cal-deadline-card ${badgeClass === 'overdue' ? 'overdue' : (badgeClass === 'urgent' ? 'urgent' : '')}">
                  <div class="cal-deadline-header">
                    <span class="cal-deadline-badge ${badgeClass}">
                      <i class="fa-solid fa-hourglass-half"></i> ${badgeText}
                    </span>
                    <button class="cal-btn-icon-danger" data-action="delete-event" data-id="${d.id}"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                  <div>
                    <h4 class="cal-deadline-title">${this.escapeHtml(d.title)}</h4>
                    ${d.notes ? `<p style="font-size: 12px; color: var(--cal-pewter); margin: 4px 0 0 0;">${this.escapeHtml(d.notes)}</p>` : ''}
                  </div>
                  <div class="cal-deadline-meta">
                    <i class="fa-regular fa-calendar"></i>
                    <span>กำหนด: ${d.date} ${d.time || '23:59'}</span>
                  </div>
                  <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <button class="cal-btn-secondary" style="flex: 1; padding: 6px;" data-action="toggle-deadline-status" data-id="${d.id}">
                      ${d.status === 'done' ? 'เปลี่ยนเป็นยังไม่เสร็จ' : '✓ ส่งแล้ว'}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. READING PLANNER PANEL
    // ──────────────────────────────────────────────────────────────────────────
    renderReadingPanel() {
      return `
        <div class="cal-panel-wrap">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 style="margin: 0; font-size: 18px; color: var(--cal-carbon);">แผนการอ่านหนังสือ (Reading Planner)</h3>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--cal-silver);">ตั้งเป้าหมายจำนวนหน้า คำนวณความเร็วอ่านต่อวัน และติดตามความคืบหน้า</p>
            </div>
            <button class="cal-btn-add" id="btn-add-reading-modal"><i class="fa-solid fa-plus"></i> เพิ่มหนังสือ</button>
          </div>

          <div class="cal-reading-grid">
            ${this.readingPlans.length === 0 ? '<div style="grid-column: 1/-1; text-align: center; color: var(--cal-silver); padding: 40px;">ยังไม่มีแผนอ่านหนังสือ เริ่มต้นเพิ่มเล่มแรกได้เลย 📖</div>' : ''}
            ${this.readingPlans.map(book => {
              const percent = Math.min(100, Math.round(((book.currentPage || 0) / (book.totalPages || 1)) * 100));
              const remainingPages = Math.max(0, (book.totalPages || 0) - (book.currentPage || 0));

              return `
                <div class="cal-book-card">
                  <div class="cal-book-top">
                    <div class="cal-book-cover" style="background: ${book.coverColor || 'var(--cal-purple)'};">
                      <i class="fa-solid fa-book"></i>
                    </div>
                    <div class="cal-book-info">
                      <div class="cal-book-title">${this.escapeHtml(book.title)}</div>
                      <div class="cal-book-author">${this.escapeHtml(book.author || 'ไม่ระบุผู้แต่ง')}</div>
                    </div>
                    <button class="cal-btn-icon-danger" data-action="delete-book" data-id="${book.id}"><i class="fa-solid fa-trash-can"></i></button>
                  </div>

                  <div class="cal-progress-bar-wrap">
                    <div class="cal-progress-fill" style="width: ${percent}%;"></div>
                  </div>

                  <div class="cal-book-stats">
                    <span>อ่านแล้ว ${book.currentPage || 0} / ${book.totalPages} หน้า</span>
                    <span><strong>${percent}%</strong></span>
                  </div>

                  ${book.targetDate ? `
                    <div style="font-size: 11px; color: var(--cal-pewter); background: var(--cal-bg-subtle); padding: 4px 8px; border-radius: 4px;">
                      🎯 จบภายใน: ${book.targetDate} (อ่านวันละ ~${book.dailyGoal || 10} หน้า)
                    </div>
                  ` : ''}

                  <div class="cal-book-actions">
                    <button class="cal-btn-quick-read" data-action="add-read-pages" data-id="${book.id}" data-amount="10">+10 หน้า</button>
                    <button class="cal-btn-quick-read" data-action="add-read-pages" data-id="${book.id}" data-amount="20">+20 หน้า</button>
                    <button class="cal-btn-quick-read" data-action="set-read-page-modal" data-id="${book.id}">กำหนดหน้า...</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. BACKLOG & REMINDERS PANEL
    // ──────────────────────────────────────────────────────────────────────────
    renderBacklogPanel() {
      const pinned = this.reminders.filter(r => r.isPinned);
      const others = this.reminders.filter(r => !r.isPinned);

      return `
        <div class="cal-panel-wrap">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 style="margin: 0; font-size: 18px; color: var(--cal-carbon);">งานค้าง & โน้ตเตือนความจำ (Backlog & Sticky Notes)</h3>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--cal-silver);">งานที่เลยกำหนดส่งจะถูกย้ายมารวบรวมที่นี่โดยอัตโนมัติ เพื่อไม่ให้ตกหล่น</p>
            </div>
            <button class="cal-btn-add" id="btn-add-reminder-modal"><i class="fa-solid fa-plus"></i> เพิ่มโน้ตเตือน</button>
          </div>

          <div class="cal-backlog-container">
            ${this.reminders.length === 0 ? '<div style="text-align: center; color: var(--cal-silver); padding: 40px;">ไม่มีงานค้างหรือโน้ตเตือนความจำ เยี่ยมมาก! 🌟</div>' : ''}
            <div class="cal-backlog-notes-grid">
              ${pinned.concat(others).map(note => `
                <div class="cal-sticky-note ${note.isPinned ? 'pinned' : ''}">
                  <div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                      <span style="font-size: 11px; color: ${note.isBacklog ? 'var(--cal-red)' : 'var(--cal-orange)'}; font-weight: 600;">
                        ${note.isBacklog ? '🚨 งานค้างเลยกำหนด' : (note.isPinned ? '📌 ปักหมุด' : '📝 โน้ตย่อ')}
                      </span>
                      <button class="cal-btn-icon-danger" data-action="delete-reminder" data-id="${note.id}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <div class="cal-sticky-text">${this.escapeHtml(note.text)}</div>
                  </div>
                  <div class="cal-sticky-footer">
                    <span>${note.dueDate ? 'กำหนดเดิม: ' + note.dueDate : ''}</span>
                    <button class="cal-btn-secondary" style="padding: 2px 8px; font-size: 11px;" data-action="reschedule-backlog" data-id="${note.id}">ย้ายไปทำวันนี้</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. TODAY SIDE PANEL
    // ──────────────────────────────────────────────────────────────────────────
    renderTodaySidePanel() {
      const todayIso = this.formatDateIso(new Date());
      const todayEvents = this.getExpandedEventsForDate(todayIso);
      const todayTodos = this.events.filter(e => e.type === 'todo' && e.date === todayIso);
      const upcomingDeadlines = this.events.filter(e => {
        if (e.type !== 'deadline' || e.status === 'done') return false;
        const diff = (new Date(e.date) - new Date()) / (1000 * 60 * 60 * 24);
        return diff >= -1 && diff <= 3;
      });

      return `
        <div class="cal-side-header">
          <h3 class="cal-side-title">สรุปวันนี้</h3>
          <span class="cal-side-date-badge">${todayIso}</span>
        </div>

        <div class="cal-side-section">
          <div class="cal-side-section-title">
            <span>ตารางกิจกรรมวันนี้</span>
            <span style="font-weight: 400;">(${todayEvents.length})</span>
          </div>
          <div class="cal-events-list">
            ${todayEvents.length === 0 ? '<div style="font-size: 12px; color: var(--cal-silver);">ไม่มีกิจกรรมวันนี้</div>' : ''}
            ${todayEvents.map(e => `
              <div class="cal-event-pill type-${e.type}" style="padding: 6px 8px;">
                <i class="fa-regular fa-clock"></i>
                <span style="flex:1;">${this.escapeHtml(e.title)}</span>
                <span style="font-size: 10px; opacity: 0.8;">${e.time || ''}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="cal-side-section">
          <div class="cal-side-section-title">
            <span>สิ่งที่ต้องทำวันนี้</span>
            <span style="font-weight: 400;">(${todayTodos.filter(t => t.status !== 'done').length})</span>
          </div>
          <div class="cal-tasks-list">
            ${todayTodos.length === 0 ? '<div style="font-size: 12px; color: var(--cal-silver);">ไม่มีงานค้างของวันนี้</div>' : ''}
            ${todayTodos.map(t => `
              <div class="cal-task-card priority-${t.priority || 'medium'}" style="padding: 8px 10px;">
                <div class="cal-task-left">
                  <span class="cal-checkbox ${t.status === 'done' ? 'checked' : ''}" data-action="toggle-todo" data-id="${t.id}">
                    ${t.status === 'done' ? '<i class="fa-solid fa-check"></i>' : ''}
                  </span>
                  <span class="cal-task-text ${t.status === 'done' ? 'done' : ''}" style="font-size: 13px;">${this.escapeHtml(t.title)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="cal-side-section" style="border-bottom: none;">
          <div class="cal-side-section-title" style="color: var(--cal-red);">
            <span>เดดไลน์ใกล้หมด (≤ 3 วัน)</span>
            <span style="font-weight: 400;">(${upcomingDeadlines.length})</span>
          </div>
          <div class="cal-tasks-list">
            ${upcomingDeadlines.length === 0 ? '<div style="font-size: 12px; color: var(--cal-silver);">ไม่มีเดดไลน์ด่วน</div>' : ''}
            ${upcomingDeadlines.map(d => `
              <div class="cal-deadline-card urgent" style="padding: 10px;">
                <div style="font-size: 13px; font-weight: 600;">${this.escapeHtml(d.title)}</div>
                <div style="font-size: 11px; color: var(--cal-red); margin-top: 4px;">ครบกำหนด: ${d.date}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // EVENT BINDINGS
    // ──────────────────────────────────────────────────────────────────────────
    bindHeaderEvents() {
      // Back to library
      document.getElementById('cal-btn-back-lib')?.addEventListener('click', () => {
        if (this.app) this.app.showLibrary();
      });

      // Navigation arrows
      document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
        this.navigatePeriod(-1);
      });
      document.getElementById('cal-next-btn')?.addEventListener('click', () => {
        this.navigatePeriod(1);
      });
      document.getElementById('cal-today-btn')?.addEventListener('click', () => {
        this.currentDate = new Date();
        this.render();
      });

      // View switcher
      document.querySelectorAll('.cal-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.currentView = btn.dataset.view;
          this.render();
        });
      });

      // Google Sync button
      document.getElementById('cal-btn-sync')?.addEventListener('click', () => {
        this.syncFromGoogleCalendar(false);
      });

      // Quick add button
      document.getElementById('cal-btn-quick-add')?.addEventListener('click', () => {
        this.openQuickAddModal();
      });

      // User avatar click (Logout / Info)
      document.getElementById('cal-user-avatar')?.addEventListener('click', () => {
        if (confirm(`เข้าสู่ระบบในชื่อ: ${this.currentUser.name} (${this.currentUser.email})\nคุณต้องการออกจากระบบหรือไม่?`)) {
          if (window.ClassroomExplorer) {
            window.ClassroomExplorer.logout();
          }
        }
      });
    }

    bindTabEvents() {
      // Tab switcher
      document.querySelectorAll('.cal-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.activeTab = btn.dataset.tab;
          this.render();
        });
      });

      // Click on day cell in month view -> open quick add with prefilled date
      document.querySelectorAll('.cal-day-cell').forEach(cell => {
        cell.addEventListener('click', (e) => {
          if (e.target.closest('.cal-event-pill')) return; // handled separately
          const date = cell.dataset.date;
          if (date) this.openQuickAddModal(date);
        });
      });

      // Click on event pill
      document.querySelectorAll('.cal-event-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = pill.dataset.eventId;
          if (id) this.openEventDetailModal(id);
        });
      });

      // To-Do quick add in To-Do tab
      const btnAddTodo = document.getElementById('btn-add-todo');
      if (btnAddTodo) {
        btnAddTodo.addEventListener('click', () => this.handleQuickAddTodo());
      }
      const inputTodo = document.getElementById('todo-input-title');
      if (inputTodo) {
        inputTodo.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.handleQuickAddTodo();
        });
      }

      // To-Do filter chips
      document.querySelectorAll('.cal-task-filter-chips .cal-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          this.todoFilter = chip.dataset.filter;
          this.render();
        });
      });

      // Deadline add modal
      document.getElementById('btn-add-deadline-modal')?.addEventListener('click', () => {
        this.openQuickAddModal(null, 'deadline');
      });

      // Reading add modal
      document.getElementById('btn-add-reading-modal')?.addEventListener('click', () => {
        this.openAddBookModal();
      });

      // Reminder add modal
      document.getElementById('btn-add-reminder-modal')?.addEventListener('click', () => {
        this.openAddReminderModal();
      });

      // Day view add button
      document.getElementById('btn-day-add-event')?.addEventListener('click', (e) => {
        const d = e.currentTarget.dataset.date;
        this.openQuickAddModal(d);
      });

      // Action delegations (toggle todo, delete, etc.)
      const container = document.getElementById('calendar-root');
      if (container) {
        container.onclick = async (e) => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;
          const action = btn.dataset.action;
          const id = btn.dataset.id;

          if (action === 'toggle-todo') {
            await this.toggleTodoDone(id);
          } else if (action === 'delete-event') {
            if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
              await this.deleteEvent(id);
            }
          } else if (action === 'toggle-deadline-status') {
            await this.toggleDeadlineStatus(id);
          } else if (action === 'delete-book') {
            if (confirm('ต้องการลบหนังสือเล่มนี้ออกจากแผนหรือไม่?')) {
              await this.deleteBook(id);
            }
          } else if (action === 'add-read-pages') {
            const amount = parseInt(btn.dataset.amount, 10) || 10;
            await this.addBookPages(id, amount);
          } else if (action === 'set-read-page-modal') {
            this.openSetBookPageModal(id);
          } else if (action === 'delete-reminder') {
            await this.deleteReminder(id);
          } else if (action === 'reschedule-backlog') {
            await this.rescheduleBacklog(id);
          }
        };
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // NAVIGATION HELPER
    // ──────────────────────────────────────────────────────────────────────────
    navigatePeriod(direction) {
      if (this.currentView === 'month') {
        this.currentDate.setMonth(this.currentDate.getMonth() + direction);
      } else if (this.currentView === 'week') {
        this.currentDate.setDate(this.currentDate.getDate() + (direction * 7));
      } else if (this.currentView === 'day') {
        this.currentDate.setDate(this.currentDate.getDate() + direction);
      }
      this.render();
    }

    getPeriodLabel() {
      const year = this.currentDate.getFullYear();
      const month = this.currentDate.getMonth();
      const thaiMonths = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      if (this.currentView === 'day') {
        return `${this.currentDate.getDate()} ${thaiMonths[month]} ${year + 543}`;
      }
      return `${thaiMonths[month]} ${year + 543} (${year})`;
    }

    getThaiMonthName(idx) {
      const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      return thaiMonths[idx] || '';
    }

    getCategoryLabel(cat) {
      switch (cat) {
        case 'study': return 'วิชาการ';
        case 'work': return 'งาน/โปรเจกต์';
        case 'personal': return 'ส่วนตัว';
        default: return 'ทั่วไป';
      }
    }

    formatDateIso(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    updateBadgeCounts() {
      const todoEl = document.getElementById('cal-badge-todo');
      if (todoEl) todoEl.innerText = this.getPendingTodoCount();

      const deadEl = document.getElementById('cal-badge-deadline');
      if (deadEl) {
        const count = this.getUrgentDeadlineCount();
        deadEl.innerText = count;
        if (count > 0) deadEl.classList.add('red');
        else deadEl.classList.remove('red');
      }

      const readEl = document.getElementById('cal-badge-reading');
      if (readEl) readEl.innerText = this.readingPlans.length;

      const backEl = document.getElementById('cal-badge-backlog');
      if (backEl) backEl.innerText = this.reminders.length;

      // Update badge on sidebar nav if present
      const navBadge = document.getElementById('calendar-badge');
      if (navBadge) {
        const totalAlerts = this.getUrgentDeadlineCount() + this.reminders.length;
        if (totalAlerts > 0) {
          navBadge.classList.remove('hidden');
          navBadge.innerText = totalAlerts;
        } else {
          navBadge.classList.add('hidden');
        }
      }
    }

    getPendingTodoCount() {
      return this.events.filter(e => e.type === 'todo' && e.status !== 'done').length;
    }

    getUrgentDeadlineCount() {
      const today = new Date();
      today.setHours(0,0,0,0);
      return this.events.filter(e => {
        if (e.type !== 'deadline' || e.status === 'done') return false;
        const target = new Date(e.date);
        target.setHours(0,0,0,0);
        const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
        return diff <= 3; // within 3 days or overdue
      }).length;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // RECURRING EVENTS LOGIC
    // ──────────────────────────────────────────────────────────────────────────
    getExpandedEventsForMonth(year, month) {
      const startDate = new Date(year, month - 1, 20); // cover margin days
      const endDate = new Date(year, month + 1, 15);
      return this.expandRecurringEvents(this.events, startDate, endDate);
    }

    getExpandedEventsForDate(dateIso) {
      const d = new Date(dateIso);
      const start = new Date(d);
      start.setDate(d.getDate() - 1);
      const end = new Date(d);
      end.setDate(d.getDate() + 1);
      return this.expandRecurringEvents(this.events, start, end).filter(e => e.date === dateIso);
    }

    expandRecurringEvents(eventsList, startDate, endDate) {
      const result = [];

      eventsList.forEach(ev => {
        if (!ev.recurring) {
          result.push(ev);
          return;
        }

        // Handle Daily
        if (ev.recurring.type === 'daily') {
          let curr = new Date(ev.date);
          const maxDate = ev.recurring.endDate ? new Date(ev.recurring.endDate) : endDate;
          while (curr <= maxDate && curr <= endDate) {
            if (curr >= startDate) {
              result.push({
                ...ev,
                id: `${ev.id}_${this.formatDateIso(curr)}`,
                date: this.formatDateIso(curr),
                isRecurringInstance: true
              });
            }
            curr.setDate(curr.getDate() + 1);
          }
        }
        // Handle Weekly
        else if (ev.recurring.type === 'weekly') {
          const daysOfWeek = ev.recurring.daysOfWeek || [new Date(ev.date).getDay()];
          let curr = new Date(ev.date);
          const maxDate = ev.recurring.endDate ? new Date(ev.recurring.endDate) : endDate;
          while (curr <= maxDate && curr <= endDate) {
            if (curr >= startDate && daysOfWeek.includes(curr.getDay())) {
              result.push({
                ...ev,
                id: `${ev.id}_${this.formatDateIso(curr)}`,
                date: this.formatDateIso(curr),
                isRecurringInstance: true
              });
            }
            curr.setDate(curr.getDate() + 1);
          }
        }
        // Handle Monthly
        else if (ev.recurring.type === 'monthly') {
          const origDate = new Date(ev.date);
          const dayOfMonth = origDate.getDate();
          let m = startDate.getMonth();
          let y = startDate.getFullYear();

          while (new Date(y, m, dayOfMonth) <= endDate) {
            const instanceDate = new Date(y, m, dayOfMonth);
            if (instanceDate >= startDate && instanceDate >= origDate) {
              result.push({
                ...ev,
                id: `${ev.id}_${this.formatDateIso(instanceDate)}`,
                date: this.formatDateIso(instanceDate),
                isRecurringInstance: true
              });
            }
            m++;
            if (m > 11) { m = 0; y++; }
          }
        } else {
          result.push(ev);
        }
      });

      return result;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // DATA ACTIONS (CRUD)
    // ──────────────────────────────────────────────────────────────────────────
    async handleQuickAddTodo() {
      const titleInput = document.getElementById('todo-input-title');
      const priorityInput = document.getElementById('todo-input-priority');
      const categoryInput = document.getElementById('todo-input-category');
      const dateInput = document.getElementById('todo-input-date');

      if (!titleInput || !titleInput.value.trim()) return;

      const newTodo = {
        id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        userId: this.userId,
        title: titleInput.value.trim(),
        type: 'todo',
        date: dateInput ? dateInput.value : this.formatDateIso(new Date()),
        priority: priorityInput ? priorityInput.value : 'medium',
        category: categoryInput ? categoryInput.value : 'study',
        status: 'pending',
        color: 'var(--cal-green)'
      };

      this.events.push(newTodo);
      if (window.Storage) await window.Storage.saveCalendarEvent(newTodo);

      titleInput.value = '';
      this.render();
    }

    async toggleTodoDone(id) {
      const baseId = id.split('_')[0];
      const todo = this.events.find(e => e.id === baseId || e.id === id);
      if (!todo) return;

      todo.status = todo.status === 'done' ? 'pending' : 'done';
      if (window.Storage) await window.Storage.saveCalendarEvent(todo);
      this.render();
    }

    async toggleDeadlineStatus(id) {
      const dead = this.events.find(e => e.id === id);
      if (!dead) return;

      dead.status = dead.status === 'done' ? 'pending' : 'done';
      if (window.Storage) await window.Storage.saveCalendarEvent(dead);
      this.render();
    }

    async deleteEvent(id) {
      const baseId = id.split('_')[0];
      const ev = this.events.find(e => e.id === baseId || e.id === id);
      if (ev && ev.googleEventId) {
        this.deleteEventFromGoogle(ev.googleEventId);
      }

      this.events = this.events.filter(e => e.id !== baseId && e.id !== id);
      if (window.Storage) await window.Storage.deleteCalendarEvent(baseId);
      this.render();
    }

    async addBookPages(bookId, amount) {
      const book = this.readingPlans.find(b => b.id === bookId);
      if (!book) return;

      book.currentPage = Math.min(book.totalPages, (book.currentPage || 0) + amount);
      if (window.Storage) await window.Storage.saveReadingPlan(book);
      this.render();
    }

    async deleteBook(id) {
      this.readingPlans = this.readingPlans.filter(b => b.id !== id);
      if (window.Storage) await window.Storage.deleteReadingPlan(id);
      this.render();
    }

    async deleteReminder(id) {
      this.reminders = this.reminders.filter(r => r.id !== id);
      if (window.Storage) await window.Storage.deleteReminder(id);
      this.render();
    }

    async rescheduleBacklog(id) {
      const reminder = this.reminders.find(r => r.id === id);
      if (!reminder) return;

      const todayIso = this.formatDateIso(new Date());

      // Create new task for today
      const newTask = {
        id: 'evt_' + Date.now(),
        userId: this.userId,
        title: reminder.text.replace('[งานเลยกำหนด] ', ''),
        type: 'todo',
        date: todayIso,
        priority: 'high',
        status: 'pending',
        category: 'work'
      };

      this.events.push(newTask);
      if (window.Storage) await window.Storage.saveCalendarEvent(newTask);

      // Remove reminder
      await this.deleteReminder(id);
      this.showToast('ย้ายงานมายังตารางวันนี้เรียบร้อยแล้ว');
      this.render();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // MODAL DIALOGS
    // ──────────────────────────────────────────────────────────────────────────
    openQuickAddModal(prefilledDate = null, defaultType = 'event') {
      const dateVal = prefilledDate || this.formatDateIso(new Date());

      const modal = document.createElement('div');
      modal.className = 'cal-modal-backdrop';
      modal.innerHTML = `
        <div class="cal-modal-card">
          <div class="cal-modal-header">
            <h3 class="cal-modal-title"><i class="fa-solid fa-plus-circle" style="color: var(--cal-blue); margin-right: 6px;"></i>เพิ่มรายการใหม่</h3>
            <button class="cal-btn-icon-danger" id="cal-modal-close" style="font-size: 16px;"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">ประเภทรายการ</label>
            <select class="cal-select" id="modal-type-select">
              <option value="event" ${defaultType === 'event' ? 'selected' : ''}>📅 กิจกรรม / ตารางนัดหมาย</option>
              <option value="todo" ${defaultType === 'todo' ? 'selected' : ''}>✅ สิ่งที่ต้องทำ (To-Do)</option>
              <option value="deadline" ${defaultType === 'deadline' ? 'selected' : ''}>🚨 สิ่งที่ต้องส่ง / เดดไลน์</option>
            </select>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">ชื่อรายการ</label>
            <input type="text" class="cal-input" id="modal-title-input" placeholder="เช่น คาบเรียนฟิสิกส์ หรือ ส่งรายงานวิจัย..." autocomplete="off">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="cal-form-group">
              <label class="cal-form-label">วันที่</label>
              <input type="date" class="cal-input" id="modal-date-input" value="${dateVal}">
            </div>
            <div class="cal-form-group">
              <label class="cal-form-label">เวลา (ไม่บังคับ)</label>
              <input type="time" class="cal-input" id="modal-time-input">
            </div>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">การทำซ้ำ (Recurring)</label>
            <select class="cal-select" id="modal-recurring-select">
              <option value="none">ไม่ทำซ้ำ</option>
              <option value="daily">ทุกวัน</option>
              <option value="weekly">ทุกสัปดาห์ (ในวันนี้)</option>
              <option value="monthly">ทุกเดือน (วันเดียวกัน)</option>
            </select>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">บันทึกช่วยจำ / รายละเอียด</label>
            <textarea class="cal-textarea" id="modal-notes-input" rows="2" placeholder="รายละเอียดเพิ่มเติม..."></textarea>
          </div>

          <div class="cal-modal-footer">
            <button class="cal-btn-secondary" id="cal-modal-cancel">ยกเลิก</button>
            <button class="cal-btn-primary" id="cal-modal-save">บันทึกรายการ</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const closeModal = () => modal.remove();
      modal.querySelector('#cal-modal-close').onclick = closeModal;
      modal.querySelector('#cal-modal-cancel').onclick = closeModal;

      modal.querySelector('#cal-modal-save').onclick = async () => {
        const title = modal.querySelector('#modal-title-input').value.trim();
        if (!title) {
          alert('กรุณากรอกชื่อรายการ');
          return;
        }

        const type = modal.querySelector('#modal-type-select').value;
        const date = modal.querySelector('#modal-date-input').value;
        const time = modal.querySelector('#modal-time-input').value;
        const recurringType = modal.querySelector('#modal-recurring-select').value;
        const notes = modal.querySelector('#modal-notes-input').value.trim();

        let recurring = null;
        if (recurringType !== 'none') {
          recurring = {
            type: recurringType,
            daysOfWeek: [new Date(date).getDay()]
          };
        }

        const newEvent = {
          id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          userId: this.userId,
          title,
          type,
          date,
          time: time || null,
          recurring,
          notes,
          status: 'pending',
          priority: type === 'deadline' ? 'high' : 'medium',
          color: type === 'deadline' ? 'var(--cal-red)' : (type === 'todo' ? 'var(--cal-green)' : 'var(--cal-blue)')
        };

        this.events.push(newEvent);
        if (window.Storage) await window.Storage.saveCalendarEvent(newEvent);

        // Push to Google Calendar if it's an event
        if (type === 'event') {
          this.pushEventToGoogleCalendar(newEvent);
        }

        closeModal();
        this.render();
      };
    }

    openEventDetailModal(id) {
      const baseId = id.split('_')[0];
      const ev = this.events.find(e => e.id === baseId || e.id === id);
      if (!ev) return;

      const modal = document.createElement('div');
      modal.className = 'cal-modal-backdrop';
      modal.innerHTML = `
        <div class="cal-modal-card">
          <div class="cal-modal-header">
            <h3 class="cal-modal-title">${this.escapeHtml(ev.title)}</h3>
            <button class="cal-btn-icon-danger" id="detail-modal-close"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div style="font-size: 13px; color: var(--cal-pewter); display: flex; flex-direction: column; gap: 8px;">
            <div>📅 วันที่: <strong>${ev.date}</strong> ${ev.time ? `(เวลา ${ev.time})` : '(ทั้งวัน)'}</div>
            <div>🏷️ ประเภท: <strong>${ev.type.toUpperCase()}</strong></div>
            ${ev.recurring ? `<div>🔁 ทำซ้ำ: <strong>${ev.recurring.type}</strong></div>` : ''}
            ${ev.notes ? `<div style="background: var(--cal-bg-subtle); padding: 8px; border-radius: 4px; margin-top: 6px;">${this.escapeHtml(ev.notes)}</div>` : ''}
          </div>
          <div class="cal-modal-footer">
            <button class="cal-btn-secondary" style="color: var(--cal-red);" id="detail-modal-delete"><i class="fa-solid fa-trash-can"></i> ลบรายการ</button>
            <button class="cal-btn-primary" id="detail-modal-ok">ปิด</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      modal.querySelector('#detail-modal-close').onclick = () => modal.remove();
      modal.querySelector('#detail-modal-ok').onclick = () => modal.remove();
      modal.querySelector('#detail-modal-delete').onclick = async () => {
        if (confirm('คุณต้องการลบรายการนี้ใช่หรือไม่?')) {
          await this.deleteEvent(ev.id);
          modal.remove();
        }
      };
    }

    openAddBookModal() {
      const modal = document.createElement('div');
      modal.className = 'cal-modal-backdrop';
      modal.innerHTML = `
        <div class="cal-modal-card">
          <div class="cal-modal-header">
            <h3 class="cal-modal-title"><i class="fa-solid fa-book" style="color: var(--cal-purple); margin-right: 6px;"></i>เพิ่มแผนการอ่านหนังสือ</h3>
            <button class="cal-btn-icon-danger" id="book-modal-close"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">ชื่อหนังสือ</label>
            <input type="text" class="cal-input" id="book-title-input" placeholder="เช่น Atomic Habits" autocomplete="off">
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">ผู้แต่ง (ไม่บังคับ)</label>
            <input type="text" class="cal-input" id="book-author-input" placeholder="เช่น James Clear">
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div class="cal-form-group">
              <label class="cal-form-label">จำนวนหน้าทั้งหมด</label>
              <input type="number" class="cal-input" id="book-pages-input" value="300" min="1">
            </div>
            <div class="cal-form-group">
              <label class="cal-form-label">หน้าที่อ่านถึงแล้ว</label>
              <input type="number" class="cal-input" id="book-current-input" value="0" min="0">
            </div>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">วันที่ต้องการอ่านจบ (ไม่บังคับ)</label>
            <input type="date" class="cal-input" id="book-target-date">
          </div>

          <div class="cal-modal-footer">
            <button class="cal-btn-secondary" id="book-modal-cancel">ยกเลิก</button>
            <button class="cal-btn-primary" id="book-modal-save">เพิ่มหนังสือ</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const close = () => modal.remove();
      modal.querySelector('#book-modal-close').onclick = close;
      modal.querySelector('#book-modal-cancel').onclick = close;

      modal.querySelector('#book-modal-save').onclick = async () => {
        const title = modal.querySelector('#book-title-input').value.trim();
        const total = parseInt(modal.querySelector('#book-pages-input').value, 10);
        if (!title || isNaN(total) || total <= 0) {
          alert('กรุณากรอกชื่อหนังสือและจำนวนหน้า');
          return;
        }

        const author = modal.querySelector('#book-author-input').value.trim();
        const current = parseInt(modal.querySelector('#book-current-input').value, 10) || 0;
        const targetDate = modal.querySelector('#book-target-date').value;

        // Calculate daily goal
        let dailyGoal = 10;
        if (targetDate) {
          const diffDays = Math.max(1, Math.ceil((new Date(targetDate) - new Date()) / (1000 * 60 * 60 * 24)));
          dailyGoal = Math.ceil((total - current) / diffDays);
        }

        const colors = ['#AF52DE', '#5856D6', '#007AFF', '#34C759', '#FF9500', '#FF2D55'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        const newBook = {
          id: 'rp_' + Date.now(),
          userId: this.userId,
          title,
          author,
          totalPages: total,
          currentPage: current,
          targetDate,
          dailyGoal,
          coverColor: randomColor
        };

        this.readingPlans.push(newBook);
        if (window.Storage) await window.Storage.saveReadingPlan(newBook);

        close();
        this.render();
      };
    }

    openSetBookPageModal(bookId) {
      const book = this.readingPlans.find(b => b.id === bookId);
      if (!book) return;

      const p = prompt(`ระบุหน้าที่อ่านถึงล่าสุด (จากทั้งหมด ${book.totalPages} หน้า):`, book.currentPage || 0);
      if (p !== null) {
        const val = parseInt(p, 10);
        if (!isNaN(val) && val >= 0) {
          book.currentPage = Math.min(book.totalPages, val);
          if (window.Storage) window.Storage.saveReadingPlan(book);
          this.render();
        }
      }
    }

    openAddReminderModal() {
      const modal = document.createElement('div');
      modal.className = 'cal-modal-backdrop';
      modal.innerHTML = `
        <div class="cal-modal-card">
          <div class="cal-modal-header">
            <h3 class="cal-modal-title"><i class="fa-solid fa-note-sticky" style="color: var(--cal-orange); margin-right: 6px;"></i>เพิ่มโน้ตเตือนความจำ</h3>
            <button class="cal-btn-icon-danger" id="rem-modal-close"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label">ข้อความเตือนความจำ</label>
            <textarea class="cal-textarea" id="rem-text-input" rows="3" placeholder="เช่น อย่าลืมส่งเอกสารใบสมัครทุน..." autocomplete="off"></textarea>
          </div>

          <div class="cal-form-group">
            <label class="cal-form-label" style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" id="rem-pinned-input" checked>
              <span>ปักหมุดไว้ด้านบนสุด</span>
            </label>
          </div>

          <div class="cal-modal-footer">
            <button class="cal-btn-secondary" id="rem-modal-cancel">ยกเลิก</button>
            <button class="cal-btn-primary" id="rem-modal-save">บันทึกโน้ต</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      const close = () => modal.remove();
      modal.querySelector('#rem-modal-close').onclick = close;
      modal.querySelector('#rem-modal-cancel').onclick = close;

      modal.querySelector('#rem-modal-save').onclick = async () => {
        const text = modal.querySelector('#rem-text-input').value.trim();
        if (!text) return;

        const isPinned = modal.querySelector('#rem-pinned-input').checked;

        const newReminder = {
          id: 'rem_' + Date.now(),
          userId: this.userId,
          text,
          isPinned,
          isBacklog: false
        };

        this.reminders.push(newReminder);
        if (window.Storage) await window.Storage.saveReminder(newReminder);

        close();
        this.render();
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 8. GOOGLE CALENDAR 2-WAY SYNC
    // ──────────────────────────────────────────────────────────────────────────
    async syncFromGoogleCalendar(silent = false) {
      if (!this.accessToken || !this.userId) return;

      this.isSyncing = true;
      const syncBtn = document.getElementById('cal-btn-sync');
      if (syncBtn) syncBtn.classList.add('spinning');

      try {
        const now = new Date();
        const timeMin = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString();
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 4, 1).toISOString();

        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&maxResults=250`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });

        if (res.status === 401) {
          // Token expired -> attempt silent refresh
          if (window.ClassroomExplorer) {
            window.ClassroomExplorer.trySilentRefresh();
          }
          return;
        }

        if (res.ok) {
          const data = await res.json();
          const gEvents = data.items || [];
          let newCount = 0;

          for (const item of gEvents) {
            if (item.status === 'cancelled') continue;

            const existing = this.events.find(e => e.googleEventId === item.id);
            const startVal = item.start?.dateTime || item.start?.date;
            if (!startVal) continue;

            const dateStr = startVal.substring(0, 10);
            const timeStr = item.start?.dateTime ? startVal.substring(11, 16) : null;

            if (!existing) {
              const localEvent = {
                id: 'evt_g_' + item.id,
                userId: this.userId,
                title: item.summary || 'กิจกรรมไม่มีชื่อ',
                type: 'event',
                date: dateStr,
                time: timeStr,
                notes: item.description || '',
                googleEventId: item.id,
                color: 'var(--cal-blue)'
              };
              this.events.push(localEvent);
              if (window.Storage) await window.Storage.saveCalendarEvent(localEvent);
              newCount++;
            }
          }

          if (!silent) {
            this.showToast(`ซิงค์ข้อมูลจาก Google Calendar สำเร็จ (เพิ่มใหม่ ${newCount} รายการ)`);
            this.render();
          }
        }
      } catch (err) {
        console.warn('Google Calendar sync error:', err);
        if (!silent) this.showToast('การซิงค์ขัดข้อง กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
      } finally {
        this.isSyncing = false;
        if (syncBtn) syncBtn.classList.remove('spinning');
      }
    }

    async pushEventToGoogleCalendar(event) {
      if (!this.accessToken) return;

      try {
        const startObj = event.time
          ? { dateTime: `${event.date}T${event.time}:00+07:00` }
          : { date: event.date };

        const endObj = event.time
          ? { dateTime: `${event.date}T${event.time}:00+07:00` }
          : { date: event.date };

        const payload = {
          summary: event.title,
          description: event.notes || 'บันทึกจาก FarmNotes LifeCalendar',
          start: startObj,
          end: endObj
        };

        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const gEvent = await res.json();
          event.googleEventId = gEvent.id;
          if (window.Storage) await window.Storage.saveCalendarEvent(event);
        }
      } catch (err) {
        console.warn('Failed to push event to Google Calendar:', err);
      }
    }

    async deleteEventFromGoogle(googleEventId) {
      if (!this.accessToken || !googleEventId) return;
      try {
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
      } catch (err) {
        console.warn('Failed to delete Google Calendar event:', err);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 9. BROWSER NOTIFICATIONS DAEMON
    // ──────────────────────────────────────────────────────────────────────────
    startNotificationDaemon() {
      // Request notification permission if supported
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => {
          Notification.requestPermission();
        }, 5000);
      }

      // Check due tasks every 60 seconds
      if (this.notificationInterval) clearInterval(this.notificationInterval);
      this.notificationInterval = setInterval(() => {
        this.checkDueNotifications();
      }, 60000);
    }

    checkDueNotifications() {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;

      const now = new Date();
      const todayIso = this.formatDateIso(now);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // Check urgent deadlines
      this.events.forEach(ev => {
        if (ev.type === 'deadline' && ev.status !== 'done' && ev.date === todayIso && !ev._notified) {
          ev._notified = true;
          new Notification('🚨 เดดไลน์วันนี้: ' + ev.title, {
            body: 'คุณมีงานที่ต้องส่งภายในวันนี้ กรุณาตรวจสอบใน FarmNotes LifeCalendar',
            icon: 'icon-192.png'
          });
        }
      });
    }

    showToast(msg) {
      if (window.CustomDialog && window.CustomDialog.toast) {
        window.CustomDialog.toast(msg, 2500);
      } else {
        alert(msg);
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
  window.LifeCalendar = new LifeCalendarEngine();

})();
