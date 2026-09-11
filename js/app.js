/**
 * GoodNotes 6 Web — Main Application Entry & Router (File Protocol Compatible)
 */

class App {
  constructor() {
    this.libraryScreen = document.getElementById('library-screen');
    this.editorScreen = document.getElementById('editor-screen');

    this.libraryController = new window.LibraryController(this);
    this.editorController = new window.EditorController(this);

    this.init();
  }

  async init() {
    try {
      await window.Storage.seedInitialSampleDataIfEmpty();
      await this.libraryController.loadLibrary();
      this.showLibrary();
    } catch (err) {
      console.error('App initialization error:', err);
    }
  }

  showLibrary() {
    this.editorScreen.classList.remove('active');
    this.libraryScreen.classList.add('active');
    this.libraryController.loadLibrary();
  }

  async openNotebook(notebookId) {
    this.libraryScreen.classList.remove('active');
    this.editorScreen.classList.add('active');
    await this.editorController.openNotebook(notebookId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
