'use strict';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function(e) {
    console.warn('[SW] Registration failed:', e);
  });
}
