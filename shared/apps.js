// Single source of truth: the tile screen and sw.js both import this.
// `files` are the app's own files beyond its folder index and icon, for the worker to precache.
export const APPS = [
  { slug: 'calendar', label: 'calendar', files: ['index.html', 'app.js', 'data.js', 'ui.js',
      'views.js', 'kanban.js', 'popup.js', 'settings.js', 'style.css'] }
];
