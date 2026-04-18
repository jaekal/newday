/**
 * Suite-wide stroke icons (Noun Project–style: simple 24×24, rounded caps).
 * Reference: https://thenounproject.com — swap in licensed NP SVGs if required.
 */
(function (global) {
  'use strict';

  var VB = '0 0 24 24';

  function svg(inner, size, sw) {
    var s = size == null ? 14 : size;
    var w = typeof sw === 'number' ? sw : 2;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      s +
      '" height="' +
      s +
      '" viewBox="' +
      VB +
      '" fill="none" stroke="currentColor" stroke-width="' +
      w +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      inner +
      '</svg>'
    );
  }

  var icons = {
    /* ── Tool classification (manual / wired / wireless) ── */
    manual: function (size) {
      return svg(
        '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        size
      );
    },
    wired: function (size) {
      return svg(
        '<path d="M12 22v-5"/><path d="M9 7V2"/><path d="M15 7V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
        size
      );
    },
    wireless: function (size) {
      return svg(
        '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/>',
        size
      );
    },

    /* ── Inferred tool types (tool management / labels) ── */
    screwdriver: function (size) {
      return icons.manual(size);
    },
    drill: function (size) {
      return svg(
        '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>',
        size
      );
    },
    dongle: function (size) {
      return svg(
        '<path d="M10 3v5M14 3v5"/><path d="M8 8h8l2 4v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6z"/><path d="M10 14h4"/>',
        size
      );
    },
    tooling3d: function (size) {
      return svg(
        '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="m3 16 9 5 9-5"/>',
        size
      );
    },
    torqueWrench: function (size) {
      return svg(
        '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        size
      );
    },
    testEquipment: function (size) {
      return svg(
        '<path d="M9 3h6"/><path d="M10 9V7a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/><path d="M8 9h8l-1 10H9L8 9z"/><path d="M10 14h4"/>',
        size
      );
    },
    package: function (size) {
      return svg(
        '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
        size
      );
    },
    wrenchFallback: function (size) {
      return icons.manual(size);
    },

    /* ── Notification / UI chrome ── */
    home: function (size) {
      return svg(
        '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
        size || 16
      );
    },
    users: function (size) {
      return svg(
        '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        size || 16
      );
    },
    keyboard: function (size) {
      return svg(
        '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h8M6 16h4"/>',
        size || 16
      );
    },
    cart: function (size) {
      return svg(
        '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
        size || 18
      );
    },
    bell: function (size) {
      return svg(
        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        size || 18
      );
    },
    kiosk: function (size) {
      return svg(
        '<rect x="5" y="3" width="14" height="11" rx="1"/><path d="M9 21h6"/><path d="M12 14v4"/>',
        size
      );
    },
    calendar: function (size) {
      return svg(
        '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        size
      );
    },
    gear: function (size) {
      return svg(
        '<circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
        size
      );
    },
    tag: function (size) {
      return svg(
        '<path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l6.59-6.58a1 1 0 0 0 0-1.41L12 2Z"/><path d="M7 7h.01"/>',
        size
      );
    },
    folderKanban: function (size) {
      return svg(
        '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/>',
        size
      );
    },
    clipboard: function (size) {
      return svg(
        '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h6"/>',
        size
      );
    },
    warning: function (size) {
      return svg(
        '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        size || 18
      );
    },
    ban: function (size) {
      return svg(
        '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
        size || 18
      );
    },
    maintenance: function (size) {
      return icons.wrenchFallback(size);
    },
    check: function (size) {
      return svg('<path d="M20 6 9 17l-5-5"/>', size || 14);
    },
    outbox: function (size) {
      return svg(
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        size || 14
      );
    },
    inbox: function (size) {
      return svg(
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 16 12 11 17 16"/><line x1="12" y1="11" x2="12" y2="3"/>',
        size || 14
      );
    },
    hourglass: function (size) {
      return svg(
        '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 13l-4.414 3.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 11l4.414-3.414A2 2 0 0 0 17 6.172V2"/>',
        size || 14
      );
    },
    alertCircle: function (size) {
      return svg(
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
        size || 14
      );
    },
    xCircle: function (size) {
      return svg(
        '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
        size || 14
      );
    },
    transfer: function (size) {
      return svg(
        '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="m19 3-3 3 3 3"/><path d="m5 21 3-3-3-3"/>',
        size || 16
      );
    },
  };

  function classification(cls, size) {
    var k = String(cls || '')
      .toLowerCase()
      .trim();
    if (k === 'manual') return icons.manual(size);
    if (k === 'wired') return icons.wired(size);
    if (k === 'wireless') return icons.wireless(size);
    return '';
  }

  function toolType(typeName, size) {
    var k = String(typeName || '').trim();
    var map = {
      Screwdriver: icons.screwdriver,
      Drill: icons.drill,
      Dongle: icons.dongle,
      '3D Tooling': icons.tooling3d,
      'Torque Wrench': icons.torqueWrench,
      'Test Equipment': icons.testEquipment,
      Other: icons.package,
    };
    var fn = map[k];
    return fn ? fn(size) : icons.wrenchFallback(size);
  }

  function notification(key, size) {
    var k = String(key || '').toLowerCase();
    var map = {
      tool: icons.manual,
      inventory: icons.package,
      audit: icons.clipboard,
      projects: icons.folderKanban,
      assets: icons.tag,
      warning: icons.warning,
      blocked: icons.ban,
    };
    var fn = map[k];
    return fn ? fn(size || 18) : icons.bell(size || 18);
  }

  /** HTML for project card source chip (inline-flex). */
  function projectSourceHtml(source) {
    var s = String(source || '').toLowerCase();
    var label = '';
    var ic = '';
    if (s === 'kiosk') {
      ic = icons.kiosk(13);
      label = 'Kiosk';
    } else if (s === 'expiration') {
      ic = icons.calendar(13);
      label = 'Calibration';
    } else if (s === 'system') {
      ic = icons.gear(13);
      label = 'System';
    } else {
      return '';
    }
    return (
      '<span class="suite-ic-inline" style="display:inline-flex;align-items:center;gap:.28rem">' +
      ic +
      '<span>' +
      label +
      '</span></span>'
    );
  }

  function expirationTypeIcon(isTool, size) {
    return isTool ? icons.manual(size || 13) : icons.package(size || 13);
  }

  global.suiteIcons = {
    svg: svg,
    icons: icons,
    classification: classification,
    toolType: toolType,
    notification: notification,
    projectSourceHtml: projectSourceHtml,
    expirationTypeIcon: expirationTypeIcon,
  };
})(typeof window !== 'undefined' ? window : globalThis);
