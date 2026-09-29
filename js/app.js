/**
 * GoodNotes 6 Web — Main Application Entry & Router (File Protocol Compatible)
 */

class App {
  constructor() {
    this.libraryScreen = document.getElementById('library-screen');
    this.editorScreen = document.getElementById('editor-screen');
    this.calendarScreen = document.getElementById('calendar-screen');

    try {
      this.libraryController = new window.LibraryController(this);
    } catch (err) {
      console.error('LibraryController init error:', err);
    }

    try {
      this.editorController = new window.EditorController(this);
    } catch (err) {
      console.error('EditorController init error:', err);
    }

    this.init();
  }

  async init() {
    try {
      await window.Storage.seedInitialSampleDataIfEmpty();
      this.showLibrary();

      if (window.WakeLockManager && typeof window.WakeLockManager.init === 'function') {
        window.WakeLockManager.init();
      }

      if (window.ClassroomExplorer && typeof window.ClassroomExplorer.init === 'function') {
        window.ClassroomExplorer.init(this);
      }

      if (window.LifeCalendar && typeof window.LifeCalendar.init === 'function') {
        window.LifeCalendar.init(this);
      }
    } catch (err) {
      console.error('App initialization error:', err);
    }
  }

  showLibrary() {
    if (this.editorScreen) this.editorScreen.classList.remove('active');
    if (this.calendarScreen) this.calendarScreen.classList.remove('active');
    if (this.libraryScreen) this.libraryScreen.classList.add('active');
    if (this.libraryController) {
      this.libraryController.loadLibrary();
    }
  }

  showCalendar() {
    if (this.libraryScreen) this.libraryScreen.classList.remove('active');
    if (this.editorScreen) this.editorScreen.classList.remove('active');
    if (this.calendarScreen) this.calendarScreen.classList.add('active');
    if (window.LifeCalendar && typeof window.LifeCalendar.show === 'function') {
      window.LifeCalendar.show();
    }
  }

  async openNotebook(notebookId) {
    if (this.libraryScreen) this.libraryScreen.classList.remove('active');
    if (this.calendarScreen) this.calendarScreen.classList.remove('active');
    if (this.editorScreen) this.editorScreen.classList.add('active');
    if (this.editorController && typeof this.editorController.openNotebook === 'function') {
      await this.editorController.openNotebook(notebookId);
    } else {
      console.error('EditorController not ready to open notebook:', notebookId);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
