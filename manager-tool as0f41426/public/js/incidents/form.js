// public/js/incidents/form.js
(() => {
  const root = document.getElementById('incidentForm');
  if (!root) return;

  const toneMap = JSON.parse(root.dataset.toneMap || '{}');
  const typeMeta = JSON.parse(root.dataset.typeMeta || '{}');
  const templates = JSON.parse(root.dataset.templates || '[]');

  const typeInput = document.getElementById('typeInput');
  const toneInput = document.getElementById('toneInput');
  const severitySelect = document.getElementById('severitySelect');

  const typeCards = Array.from(document.querySelectorAll('.type-card'));
  const toneChipRow = document.getElementById('toneChipRow');
  const typeHelperTitle = document.getElementById('typeHelperTitle');
  const typeHelperText = document.getElementById('typeHelperText');

  const templateSelect = document.getElementById('templateSelect');
  const applyTemplateBtn = document.getElementById('applyTemplate');
  const buildDetailsBtn = document.getElementById('buildDetailsBtn');

  const whatHappened = document.getElementById('whatHappened');
  const behaviorBox = document.getElementById('behaviorBox');
  const impactBox = document.getElementById('impactBox');
  const actionTakenBox = document.getElementById('actionTakenBox');
  const expectationBox = document.getElementById('expectationBox');
  const responseBox = document.getElementById('responseBox');

  const detailsBox = document.getElementById('detailsBox');
  const detailsPreview = document.getElementById('detailsPreview');

  const fuToggle = document.getElementById('fuToggle');
  const fuStatus = document.getElementById('fuStatus');
  const fuDue = document.getElementById('fuDue');
  const fuOutcome = document.getElementById('fuOutcome');

  const followUpBody = document.getElementById('followUpBody');
  const followUpToggleBtn = document.getElementById('followUpToggleBtn');

  const exampleModalBackdrop = document.getElementById('exampleModalBackdrop');
  const showExampleBtn = document.getElementById('showExampleBtn');
  const closeExampleBtn = document.getElementById('closeExampleBtn');
  const exampleModalTitle = document.getElementById('exampleModalTitle');
  const exampleModalText = document.getElementById('exampleModalText');
  const exampleModalBody = document.getElementById('exampleModalBody');

  function titleize(s) {
    return String(s || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function nextDate(daysToAdd) {
    const d = new Date();
    d.setDate(d.getDate() + daysToAdd);
    return d.toISOString().slice(0, 10);
  }

  function setFollowUpEnabled(enabled) {
    if (!fuStatus || !fuDue || !fuOutcome) return;

    fuStatus.disabled = !enabled;
    fuDue.disabled = !enabled;
    fuOutcome.disabled = !enabled;

    if (!enabled) {
      fuStatus.value = 'NO_ACTION';
    } else if ((fuStatus.value || '').toUpperCase() === 'NO_ACTION') {
      fuStatus.value = 'OPEN';
    }
  }

  function setFollowUpPanel(open) {
    if (!followUpBody || !followUpToggleBtn) return;
    followUpBody.classList.toggle('open', open);
    followUpToggleBtn.textContent = open ? 'Close' : 'Open';
  }

  function buildToneChips(type, preserveIfValid) {
    if (!toneChipRow || !toneInput) return;

    const tones = toneMap[type] || [];
    const current = (toneInput.value || '').toUpperCase();
    const preserveTone = preserveIfValid && tones.includes(current);
    const meta = typeMeta[type] || {};

    toneChipRow.innerHTML = '';

    const toneToUse = preserveTone ? current : (meta.defaultTone || tones[0] || '');

    tones.forEach((tone) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tone-chip' + (tone === toneToUse ? ' active' : '');
      btn.dataset.tone = tone;
      btn.textContent = titleize(tone);
      btn.addEventListener('click', () => {
        toneInput.value = tone;
        buildToneChips(type, true);
      });
      toneChipRow.appendChild(btn);
    });

    toneInput.value = toneToUse;
  }

  function applyTypeSelection(type, preserveTone) {
    if (!typeInput) return;

    typeInput.value = type;

    typeCards.forEach((card) => {
      card.classList.toggle('active', card.dataset.type === type);
    });

    const meta = typeMeta[type] || {};

    if (typeHelperTitle) {
      typeHelperTitle.textContent = meta.label || titleize(type);
    }

    if (typeHelperText) {
      typeHelperText.textContent = meta.helper || '';
    }

    if (!preserveTone) {
      if (meta.defaultSeverity && severitySelect) {
        severitySelect.value = meta.defaultSeverity;
      }

      if (meta.followUpSuggested) {
        if (fuToggle) fuToggle.checked = true;
        setFollowUpEnabled(true);
        setFollowUpPanel(true);
        if (fuDue && !fuDue.value) fuDue.value = nextDate(7);
      } else {
        if (fuToggle) fuToggle.checked = false;
        setFollowUpEnabled(false);
      }
    }

    buildToneChips(type, preserveTone);
  }

  function buildStructuredDetails() {
    if (!detailsBox) return;

    const sections = [
      ['What happened', whatHappened?.value],
      ['Observed behavior', behaviorBox?.value],
      ['Impact', impactBox?.value],
      ['Action taken / coaching provided', actionTakenBox?.value],
      ['Expectation / standard reviewed', expectationBox?.value],
      ['Staff response / commitment', responseBox?.value],
    ];

    const output = sections
      .filter(([_, value]) => String(value || '').trim())
      .map(([label, value]) => `${label}:\n${String(value).trim()}`)
      .join('\n\n');

    if (output.trim()) {
      detailsBox.value = output;
      refreshPreview();
    }
  }

  function refreshPreview() {
    if (!detailsPreview || !detailsBox) return;
    const val = (detailsBox.value || '').trim();
    detailsPreview.textContent = val || 'Nothing entered yet.';
  }

  function showExample() {
    if (!exampleModalBackdrop || !exampleModalTitle || !exampleModalText || !exampleModalBody) return;

    const type = (typeInput?.value || 'COACHING').toUpperCase();
    const tone = (toneInput?.value || '').toUpperCase();
    const meta = typeMeta[type] || {};

    exampleModalTitle.textContent = `${meta.label || titleize(type)} Example`;
    exampleModalText.textContent = meta.helper || '';

    const examples = {
      POSITIVE:
`Title:
Recognized for stepping in to support rack completion during backlog

Details:
What happened:
Employee stepped in to support a neighboring work area that was behind schedule.

Observed behavior:
Voluntarily assisted without being asked and maintained quality while helping.

Impact:
Helped recover output and supported team flow.

Action taken / coaching provided:
Recognized the initiative and thanked the employee for supporting the broader team.

Expectation / standard reviewed:
Reinforced teamwork and ownership as positive examples.

Staff response / commitment:
Employee appreciated the feedback and stated willingness to continue supporting when needed.`,
      COACHING:
`Title:
Coached on leaving assigned area during active shift

Details:
What happened:
Employee left assigned work area during the active shift without notifying leadership.

Observed behavior:
Area was left uncovered and work continuity was interrupted.

Impact:
Created avoidable disruption and reduced accountability to assigned duties.

Action taken / coaching provided:
Reviewed expectation to notify leadership before leaving the area.

Expectation / standard reviewed:
Maintaining area coverage and clear communication during shift.

Staff response / commitment:
Employee acknowledged the expectation and agreed to notify leadership moving forward.`,
      FORMAL:
`Title:
Formal documentation for repeated attendance issue

Details:
Policy / standard:
Attendance and punctuality expectations.

Observed issue:
Employee arrived late repeatedly after prior coaching.

Impact:
Delayed shift readiness and affected team coverage.

Required action:
Employee was informed that continued issues may lead to further escalation.

Support provided:
Reviewed attendance expectations and available support channels.

Follow-up date:
Set for 7 days from documentation.

Employee response:
Employee acknowledged the concern and stated intent to improve.`,
      INFO:
`Title:
Administrative note regarding temporary reassignment

Details:
Context:
Employee was temporarily reassigned to support another area.

Operational note:
Reassignment was communicated at shift start.

Relevant details:
No performance concern or corrective action associated.

Reference / next step:
Monitor staffing balance and update assignment record if extended.`,
    };

    exampleModalBody.textContent = examples[type] || `Type: ${type}\nTone: ${tone}`;
    exampleModalBackdrop.classList.add('open');
  }

  typeCards.forEach((card) => {
    card.addEventListener('click', () => {
      applyTypeSelection(card.dataset.type, false);
    });
  });

  if (fuToggle) {
    fuToggle.addEventListener('change', () => {
      setFollowUpEnabled(!!fuToggle.checked);
      if (fuToggle.checked) setFollowUpPanel(true);
      if (fuToggle.checked && fuDue && !fuDue.value) fuDue.value = nextDate(7);
    });
  }

  if (followUpToggleBtn) {
    followUpToggleBtn.addEventListener('click', () => {
      setFollowUpPanel(!followUpBody?.classList.contains('open'));
    });
  }

  if (buildDetailsBtn) buildDetailsBtn.addEventListener('click', buildStructuredDetails);
  if (detailsBox) detailsBox.addEventListener('input', refreshPreview);

  if (applyTemplateBtn) {
    applyTemplateBtn.addEventListener('click', () => {
      const key = (templateSelect?.value || '').toUpperCase();
      if (!key || !detailsBox) return;

      const t = templates.find((x) => String(x.key || '').toUpperCase() === key);
      if (!t) return;

      const current = detailsBox.value || '';
      const insert = t.text || '';
      detailsBox.value = current.trim()
        ? current.trim() + '\n\n' + insert
        : insert;

      refreshPreview();
      detailsBox.focus();
    });
  }

  if (showExampleBtn) showExampleBtn.addEventListener('click', showExample);
  if (closeExampleBtn) {
    closeExampleBtn.addEventListener('click', () => {
      exampleModalBackdrop?.classList.remove('open');
    });
  }

  if (exampleModalBackdrop) {
    exampleModalBackdrop.addEventListener('click', (e) => {
      if (e.target === exampleModalBackdrop) {
        exampleModalBackdrop.classList.remove('open');
      }
    });
  }

  const initialType = (typeInput?.value || 'COACHING').toUpperCase();
  const initialFollowUpOpen =
    !!fuToggle?.checked || !!(typeMeta[initialType] && typeMeta[initialType].followUpSuggested);

  applyTypeSelection(initialType, true);
  setFollowUpEnabled(!!fuToggle?.checked);
  setFollowUpPanel(initialFollowUpOpen);
  refreshPreview();
})();