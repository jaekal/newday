// public/js/csrf.js
//
// Shared CSRF helper. Reads the current CSRF token from (in order):
//   1. <meta name="csrf-token"> (populated by EJS-rendered pages)
//   2. The non-HttpOnly XSRF-TOKEN cookie set by middleware/csrf.js
//
// Exposes the token on window.__csrf() so feature modules can pick it up
// without re-implementing the same lookup.

(function () {
  'use strict';

  function readMeta() {
    try {
      var el = document.querySelector('meta[name="csrf-token"]');
      return (el && el.content) ? String(el.content) : '';
    } catch (e) {
      return '';
    }
  }

  function readCookie() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) {
      return '';
    }
  }

  function token() {
    return readMeta() || readCookie() || '';
  }

  window.__csrf = token;
})();
