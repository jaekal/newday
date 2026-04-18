/* public/js/staffProfile.js */
(function () {
  // ---------------------------
  // Helpers
  // ---------------------------
  function safeParseJsonScript(id, fallback) {
    try {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const txt = el.textContent || el.innerText || '';
      if (!txt.trim()) return fallback;
      return JSON.parse(txt);
    } catch (e) {
      console.warn('[staffProfile] JSON parse failed for', id, e);
      return fallback;
    }
  }

  function pad2(n){ return String(n).padStart(2,'0'); }
  function toISODate(y,m,d){ return y + '-' + pad2(m) + '-' + pad2(d); }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ---------------------------
  // Review details toggler
  // ---------------------------
  document.querySelectorAll('.toggle-details').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-review-id');
      const row = document.getElementById('review-details-' + id);
      if (!row) return;

      const isHidden = row.style.display === 'none' || row.style.display === '';
      document.querySelectorAll('.history-details-row').forEach(r => { if (r !== row) r.style.display = 'none'; });
      row.style.display = isHidden ? 'table-row' : 'none';
    });
  });

  // ---------------------------
  // Assignment show-more toggler
  // ---------------------------
  const assignmentToggle = document.getElementById('toggle-assignment-details');
  if (assignmentToggle) {
    if (!assignmentToggle.getAttribute('data-original-label')) {
      assignmentToggle.setAttribute('data-original-label', assignmentToggle.textContent);
    }
    assignmentToggle.addEventListener('click', () => {
      const state = assignmentToggle.getAttribute('data-state') || 'collapsed';
      const extraRows = document.querySelectorAll('.extra-assignment-row');
      if (!extraRows.length) return;
      const expanding = state === 'collapsed';
      extraRows.forEach(row => { row.style.display = expanding ? 'table-row' : 'none'; });
      assignmentToggle.setAttribute('data-state', expanding ? 'expanded' : 'collapsed');
      assignmentToggle.textContent = expanding ? 'Hide extra assignment days' : assignmentToggle.getAttribute('data-original-label');
    });
  }

  // ---------------------------
  // Training filter + preview
  // ---------------------------
  (function trainingUI() {
    const profileData = safeParseJsonScript('pdmsProfileData', { trainingPreviewLimit: 5 });
    const previewLimit = Number(profileData.trainingPreviewLimit || 5);

    const chips = Array.from(document.querySelectorAll('.chip-filter'));
    const cards = Array.from(document.querySelectorAll('.training-course-card'));
    const toggleBtn = document.getElementById('toggle-training-courses');

    if (!chips.length || !cards.length) return;

    function setActiveChip(target) {
      chips.forEach(c => c.classList.remove('active'));
      target.classList.add('active');
    }

    function applyPreviewLimit() {
      const collapsed = toggleBtn && (toggleBtn.getAttribute('data-state') || 'collapsed') === 'collapsed';
      if (!collapsed) {
        cards.forEach(card => card.classList.remove('is-hidden'));
        return;
      }
      cards.forEach(card => {
        if (card.style.display === 'none') return;
        const idx = Number(card.getAttribute('data-index') || '0');
        if (idx >= previewLimit) card.classList.add('is-hidden');
        else card.classList.remove('is-hidden');
      });
    }

    function applyFilter(filter) {
      const upper = (filter || 'ALL').toUpperCase();
      cards.forEach(card => {
        const s = (card.getAttribute('data-status') || '').toUpperCase();
        const show = (upper === 'ALL') ? true : (s === upper);
        card.style.display = show ? '' : 'none';
      });
      applyPreviewLimit();
    }

    chips.forEach(chip => {
      chip.addEventListener('click', function () {
        const filter = (chip.getAttribute('data-filter') || 'ALL').toUpperCase();
        setActiveChip(chip);
        applyFilter(filter);
      });
    });

    if (toggleBtn) {
      const original = toggleBtn.getAttribute('data-original-label') || toggleBtn.textContent;
      toggleBtn.addEventListener('click', () => {
        const state = toggleBtn.getAttribute('data-state') || 'collapsed';
        const expanding = state === 'collapsed';
        toggleBtn.setAttribute('data-state', expanding ? 'expanded' : 'collapsed');
        toggleBtn.textContent = expanding ? ('Show top ' + previewLimit) : original;

        const activeChip = document.querySelector('.chip-filter.active');
        const f = activeChip ? activeChip.getAttribute('data-filter') : 'ALL';
        applyFilter(f);
      });
    }

    applyFilter('ALL');
  })();

  // ---------------------------
  // Compliance Calendar + Summary + Risk filter + Talking Points
  // ---------------------------
  (function complianceCalendar() {
    const payload = safeParseJsonScript('pdmsComplianceData', { esdByDate: {}, attByDate: {}, staff: {} });
    const esdByDate = payload.esdByDate || {};
    const attByDate = payload.attByDate || {};
    const staffMeta = payload.staff || {};

    const grid = document.getElementById('complianceCalendar');
    const title = document.getElementById('calTitle');
    const btnPrev = document.getElementById('calPrevMonth');
    const btnNext = document.getElementById('calNextMonth');
    const btnToday = document.getElementById('calToday');

    const details = document.getElementById('calDetails');
    const detailsTitle = document.getElementById('calDetailsTitle');
    const detailsSubtitle = document.getElementById('calDetailsSubtitle');
    const detailsClose = document.getElementById('calDetailsClose');
    const openTP = document.getElementById('calOpenTalkingPoints');
    const esdBlock = document.getElementById('calEsdBlock');
    const attBlock = document.getElementById('calAttBlock');

    const riskToggle = document.getElementById('calRiskToggle');
    const clearSel = document.getElementById('calClearSelection');

    const sumEsdPass = document.getElementById('sumEsdPass');
    const sumEsdMissing = document.getElementById('sumEsdMissing');
    const sumAttPresent = document.getElementById('sumAttPresent');
    const sumAttLate = document.getElementById('sumAttLate');
    const sumAttAbsent = document.getElementById('sumAttAbsent');
    const sumLateRate = document.getElementById('sumLateRate');

    // If the calendar section isn't on the page, exit gracefully.
    if (!grid || !title || !btnPrev || !btnNext || !btnToday) return;

    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let selectedDayISO = null;

    function monthLabel(date) {
      return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    }

    function computeEsdBadge(dayISO) {
      const e = esdByDate[dayISO];
      if (!e) return { text: 'ESD: NONE', cls: 'mini-badge mini-muted', level: 'none' };
      const r = (e.finalResult || '').toUpperCase();
      if (r === 'PASS') return { text: 'ESD: PASS', cls: 'mini-badge mini-ok', level: 'ok' };
      return { text: 'ESD: FAIL', cls: 'mini-badge mini-bad', level: 'bad' };
    }

    function computeAttBadge(dayISO) {
      const a = attByDate[dayISO];
      if (!a) return { text: 'ATT: —', cls: 'mini-badge mini-muted', level: 'none' };

      const s = (a.status || '').toUpperCase();
      const p = (a.punctualityBucket || '').toUpperCase();

      if (s === 'ABSENT') return { text: 'ATT: Absent', cls: 'mini-badge mini-bad', level: 'bad' };
      if (s === 'LATE' || p === 'LATE' || p === 'UNPUNCTUAL') return { text: 'ATT: Late', cls: 'mini-badge mini-warn', level: 'warn' };
      if (s === 'PRESENT' || p === 'ON_TIME') return { text: 'ATT: Present', cls: 'mini-badge mini-ok', level: 'ok' };
      return { text: 'ATT: ' + (a.status || '—'), cls: 'mini-badge', level: 'none' };
    }

    function overallTint(esdLevel, attLevel) {
      if (esdLevel === 'bad' || attLevel === 'bad') return 'tint-bad';
      if (esdLevel === 'none' && attLevel === 'none') return '';
      if (esdLevel === 'ok' && attLevel === 'ok') return 'tint-ok';
      if (esdLevel === 'none' && attLevel === 'ok') return 'tint-ok';
      if (esdLevel === 'ok' && attLevel === 'none') return 'tint-ok';
      return 'tint-warn';
    }

    function isIssueDay(dayISO) {
      const e = esdByDate[dayISO] || null;
      const a = attByDate[dayISO] || null;

      const esdIssue = (!e) || ((e.finalResult || '').toUpperCase() !== 'PASS');

      let attIssue = false;
      if (a) {
        const s = (a.status || '').toUpperCase();
        const p = (a.punctualityBucket || '').toUpperCase();
        attIssue = (s === 'ABSENT' || s === 'LATE' || p === 'LATE' || p === 'UNPUNCTUAL');
      }

      return esdIssue || attIssue;
    }

    function pct(n, d) {
      if (!d) return '—';
      return Math.round((n / d) * 100) + '%';
    }

    function computeMonthSummary(anchorDate) {
      const year = anchorDate.getFullYear();
      const month = anchorDate.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      let esdTracked = 0, esdPass = 0, esdMissing = 0;
      let attTracked = 0, attPresent = 0, attLate = 0, attAbsent = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const iso = toISODate(year, month + 1, d);

        const e = esdByDate[iso];
        if (!e) esdMissing++;
        else {
          esdTracked++;
          if ((e.finalResult || '').toUpperCase() === 'PASS') esdPass++;
        }

        const a = attByDate[iso];
        if (a) {
          attTracked++;
          const s = (a.status || '').toUpperCase();
          const p = (a.punctualityBucket || '').toUpperCase();

          if (s === 'ABSENT') attAbsent++;
          else if (s === 'LATE' || p === 'LATE' || p === 'UNPUNCTUAL') attLate++;
          else attPresent++;
        }
      }

      return {
        esdTracked, esdPass, esdMissing,
        attTracked, attPresent, attLate, attAbsent,
        esdPassRate: (esdTracked ? pct(esdPass, esdTracked) : '—'),
        latenessRate: (attTracked ? pct(attLate, attTracked) : '—')
      };
    }

    function renderMonthSummary(anchorDate) {
      const s = computeMonthSummary(anchorDate);
      if (sumEsdPass) sumEsdPass.textContent = 'ESD Pass rate: ' + s.esdPassRate;
      if (sumEsdMissing) sumEsdMissing.textContent = 'ESD Missing days: ' + s.esdMissing;

      if (sumAttPresent) sumAttPresent.textContent = 'Present: ' + s.attPresent;
      if (sumAttLate) sumAttLate.textContent = 'Late: ' + s.attLate;
      if (sumAttAbsent) sumAttAbsent.textContent = 'Absent: ' + s.attAbsent;
      if (sumLateRate) sumLateRate.textContent = 'Lateness rate: ' + s.latenessRate;
    }

    function applyRiskFilter(mode) {
      const cells = Array.from(grid.querySelectorAll('.cal-day'));
      const riskOn = (mode || 'all') === 'risk';

      cells.forEach(cell => {
        const iso = cell.getAttribute('data-iso');
        const out = cell.classList.contains('is-out');

        if (!riskOn) {
          cell.classList.remove('is-hidden');
          return;
        }

        if (out) {
          cell.classList.add('is-hidden');
          return;
        }

        const issue = isIssueDay(iso);
        if (!issue) cell.classList.add('is-hidden');
        else cell.classList.remove('is-hidden');
      });
    }

    function openDetails(dayISO) {
      selectedDayISO = dayISO;

      const e = esdByDate[dayISO] || null;
      const a = attByDate[dayISO] || null;

      if (details) details.style.display = 'block';
      if (detailsTitle) detailsTitle.textContent = 'Details: ' + dayISO;

      const subtitleParts = [];
      if (e && e.shiftLabel) subtitleParts.push('ESD shift: ' + e.shiftLabel);
      if (a && a.rawStatusSummary) subtitleParts.push('Attendance: ' + a.rawStatusSummary);
      if (detailsSubtitle) detailsSubtitle.textContent = subtitleParts.length ? subtitleParts.join(' • ') : 'No records for this day.';

      if (esdBlock) {
        if (!e) {
          esdBlock.innerHTML = '<div class="muted">No ESD entries for this day.</div>';
        } else {
          esdBlock.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;">
              <span class="chip small">Result: <strong>${esc(e.finalResult || '—')}</strong></span>
              <span class="chip small">Attempts: <strong>${esc(e.totalAttempts)}</strong></span>
              <span class="chip small">Until PASS: <strong>${esc(e.attemptsUntilPass != null ? e.attemptsUntilPass : '—')}</strong></span>
            </div>
            <div class="muted small">First attempt: <strong>${esc(e.firstAttemptTimeLabel || '—')}</strong></div>
            <div class="muted small">First PASS: <strong>${esc(e.firstPassTimeLabel || '—')}</strong></div>
            <div class="muted small">Window: <strong>${esc(e.windowLabel || '—')}</strong></div>
          `;
        }
      }

      if (attBlock) {
        if (!a) {
          attBlock.innerHTML = '<div class="muted">No attendance data for this day.</div>';
        } else {
          attBlock.innerHTML = `
            <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;">
              <span class="chip small">Status: <strong>${esc(a.status || '—')}</strong></span>
              <span class="chip small">Punctuality: <strong>${esc(a.punctualityBucket || '—')}</strong></span>
              <span class="chip small">Minutes late: <strong>${esc(a.minutesLate != null ? a.minutesLate : '—')}</strong></span>
            </div>
            <div class="muted small">Raw: <strong>${esc(a.rawStatusSummary || '—')}</strong></div>
          `;
        }
      }

      if (details && details.scrollIntoView) {
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function closeDetails() {
      selectedDayISO = null;
      if (details) details.style.display = 'none';
    }

    function renderCalendar(anchorDate) {
      const year = anchorDate.getFullYear();
      const month = anchorDate.getMonth();

      title.textContent = monthLabel(anchorDate);
      renderMonthSummary(anchorDate);

      grid.innerHTML = '';

      // headers
      DOW.forEach(d => {
        const h = document.createElement('div');
        h.className = 'cal-head';
        h.textContent = d;
        grid.appendChild(h);
      });

      const first = new Date(year, month, 1);
      const startDow = first.getDay();
      const startDate = new Date(year, month, 1 - startDow);

      for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);

        const isOut = d.getMonth() !== month;
        const dayISO = toISODate(d.getFullYear(), d.getMonth() + 1, d.getDate());

        const esd = computeEsdBadge(dayISO);
        const att = computeAttBadge(dayISO);
        const tint = overallTint(esd.level, att.level);

        const cell = document.createElement('div');
        cell.className = 'cal-day' + (isOut ? ' is-out' : '') + (tint ? ' ' + tint : '');
        cell.setAttribute('data-iso', dayISO);

        const top = document.createElement('div');
        top.style.display = 'flex';
        top.style.justifyContent = 'space-between';
        top.style.alignItems = 'baseline';
        top.style.gap = '0.35rem';

        const num = document.createElement('div');
        num.className = 'date-num';
        num.textContent = String(d.getDate());

        top.appendChild(num);

        const badges = document.createElement('div');
        badges.className = 'cal-badges';

        const b1 = document.createElement('span');
        b1.className = esd.cls;
        b1.textContent = esd.text;

        const b2 = document.createElement('span');
        b2.className = att.cls;
        b2.textContent = att.text;

        badges.appendChild(b1);
        badges.appendChild(b2);

        cell.appendChild(top);
        cell.appendChild(badges);

        cell.addEventListener('click', () => openDetails(dayISO));
        grid.appendChild(cell);
      }

      const mode = riskToggle ? (riskToggle.getAttribute('data-mode') || 'all') : 'all';
      applyRiskFilter(mode);
    }

    // Controls
    let anchor = new Date();
    anchor.setHours(0,0,0,0);

    btnPrev.addEventListener('click', () => {
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
      renderCalendar(anchor);
    });

    btnNext.addEventListener('click', () => {
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      renderCalendar(anchor);
    });

    btnToday.addEventListener('click', () => {
      anchor = new Date();
      anchor.setHours(0,0,0,0);
      renderCalendar(anchor);
    });

    if (detailsClose) detailsClose.addEventListener('click', closeDetails);
    if (clearSel) clearSel.addEventListener('click', closeDetails);

    if (riskToggle) {
      riskToggle.addEventListener('click', () => {
        const mode = riskToggle.getAttribute('data-mode') || 'all';
        const next = (mode === 'all') ? 'risk' : 'all';
        riskToggle.setAttribute('data-mode', next);
        riskToggle.textContent = (next === 'risk') ? 'Risk filter: ON' : 'Risk filter: OFF';
        applyRiskFilter(next);
      });
    }

    // Talking Points modal
    const tpOverlay = document.getElementById('tpOverlay');
    const tpClose = document.getElementById('tpClose');
    const tpCopy = document.getElementById('tpCopy');
    const tpText = document.getElementById('tpText');
    const tpMeta = document.getElementById('tpMeta');

    function buildTalkingPoints(dayISO) {
      const e = esdByDate[dayISO] || null;
      const a = attByDate[dayISO] || null;

      const lines = [];
      lines.push(`1:1 Talking Points`);
      lines.push(`Staff: ${staffMeta.name || 'Staff'}${staffMeta.employeeId ? ' (Emp ' + staffMeta.employeeId + ')' : ''}`);
      if (staffMeta.position) lines.push(`Position: ${staffMeta.position}`);
      lines.push(`Date: ${dayISO}`);
      lines.push(``);

      lines.push(`What went well:`);
      lines.push(`- `);
      lines.push(``);

      lines.push(`Opportunities / follow-up:`);
      if (!e) {
        lines.push(`- ESD: No record found. Confirm process and timing, reinforce daily compliance expectations.`);
      } else if ((e.finalResult || '').toUpperCase() !== 'PASS') {
        lines.push(`- ESD: ${e.finalResult || 'FAIL'} (Attempts: ${e.totalAttempts || '—'}). Ask what caused the failure and what support is needed.`);
      } else {
        lines.push(`- ESD: PASS (First PASS: ${e.firstPassTimeLabel || '—'}).`);
      }

      if (a) {
        const s = (a.status || '').toUpperCase();
        const p = (a.punctualityBucket || '').toUpperCase();
        if (s === 'ABSENT') lines.push(`- Attendance: Absent. Confirm reason, policy alignment, and plan for prevention.`);
        else if (s === 'LATE' || p === 'LATE' || p === 'UNPUNCTUAL') lines.push(`- Attendance: Late (${a.minutesLate != null ? a.minutesLate + ' min' : '—'}). Confirm root cause and corrective habit.`);
        else lines.push(`- Attendance: Present / on time.`);
      } else {
        lines.push(`- Attendance: No record found. Verify data source or badge scan behavior.`);
      }

      lines.push(``);
      lines.push(`Action items:`);
      lines.push(`- Owner: ${staffMeta.name || 'Staff'} | Due: ____ | Action: ____`);
      lines.push(`- Owner: Lead/Supervisor | Due: ____ | Action: ____`);
      lines.push(``);
      lines.push(`Notes:`);
      lines.push(`- `);

      return lines.join('\n');
    }

    function openTalkingPoints() {
      const dayISO = selectedDayISO;
      if (!dayISO) return;

      if (tpMeta) tpMeta.textContent = `Staff: ${staffMeta.name || 'Staff'} • Date: ${dayISO}`;
      if (tpText) tpText.value = buildTalkingPoints(dayISO);

      if (tpOverlay) {
        tpOverlay.style.display = 'flex';
        tpOverlay.setAttribute('aria-hidden', 'false');
      }
    }

    function closeTalkingPoints() {
      if (tpOverlay) {
        tpOverlay.style.display = 'none';
        tpOverlay.setAttribute('aria-hidden', 'true');
      }
    }

    if (openTP) openTP.addEventListener('click', openTalkingPoints);
    if (tpClose) tpClose.addEventListener('click', closeTalkingPoints);
    if (tpOverlay) {
      tpOverlay.addEventListener('click', (e) => {
        if (e.target === tpOverlay) closeTalkingPoints();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTalkingPoints();
    });

    if (tpCopy) {
      tpCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText((tpText && tpText.value) ? tpText.value : '');
          tpCopy.textContent = 'Copied';
          setTimeout(() => tpCopy.textContent = 'Copy', 900);
        } catch (err) {
          alert('Copy failed. You can manually copy from the text box.');
        }
      });
    }

    // Initial render
    renderCalendar(anchor);
  })();
})();
