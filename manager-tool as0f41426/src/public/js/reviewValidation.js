/**
 * reviewValidation.js
 * src/public/js/reviewValidation.js
 *
 * Reusable inline validation for monthly review score inputs.
 * Consumed by the new-review form (new.ejs).
 *
 * Exports (via window.ReviewValidation for non-module EJS usage):
 *   validateScore(input)            — validate one input, show/clear its error
 *   validateAllScores(options)      — validate every visible score input
 *   attachSubmitGuard(form, options) — wire the form submit event
 */

(function (global) {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────

  const SCORE_MIN = 1;
  const SCORE_MAX = 5;

  // Field names for the three Leading People criteria.
  // These are only required when the leading bucket is visible.
  const LEADING_FIELDS = [
    'decisionMakingWithRisk',
    'enableTheTeam',
    'hireDevelopManage',
  ];

  // Maps each score field to its paired comment textarea name.
  // Comment is required when score is 1, 2, 4, or 5 (anything except 3 or blank).
  var COMMENT_FIELDS = {
    positiveAttitude:       'positiveAttitudeComment',
    proactive:              'proactiveComment',
    integrity:              'integrityComment',
    accountability2:        'accountability2Comment',
    problemSolving:         'problemSolvingComment',
    efficiency:             'efficiencyComment',
    resultsOrientation:     'resultsOrientationComment',
    communication:          'communicationComment',
    continuousImprovement:  'continuousImprovementComment',
    teamwork2:              'teamwork2Comment',
    collaboration:          'collaborationComment',
    buildTrust:             'buildTrustComment',
    decisionMakingWithRisk: 'decisionMakingWithRiskComment',
    enableTheTeam:          'enableTheTeamComment',
    hireDevelopManage:      'hireDevelopManageComment',
  };

  // Human-readable labels for each criterion field (used in error messages).
  const FIELD_LABELS = {
    positiveAttitude:       'Positive Attitude',
    proactive:              'Proactive',
    integrity:              'Integrity',
    accountability2:        'Accountability',
    problemSolving:         'Problem Solving',
    efficiency:             'Efficiency',
    resultsOrientation:     'Results',
    communication:          'Communication',
    continuousImprovement:  'Continuous Improvement',
    teamwork2:              'Teamwork',
    collaboration:          'Collaboration',
    buildTrust:             'Build Trust',
    decisionMakingWithRisk: 'Decision Making with Risk',
    enableTheTeam:          'Enable the Team',
    hireDevelopManage:      'Hire / Develop / Manage',
  };

  // ── Comment error element management ────────────────────────────────────────

  function getOrCreateCommentErrorEl(textarea) {
    if (textarea._commentError) return textarea._commentError;
    var span = document.createElement('span');
    span.className = 'score-validation-error';
    span.setAttribute('role', 'alert');
    span.setAttribute('aria-live', 'polite');
    textarea.after(span);
    textarea._commentError = span;
    return span;
  }

  function showCommentError(textarea, message) {
    var errEl = getOrCreateCommentErrorEl(textarea);
    errEl.textContent = message;
    errEl.setAttribute('aria-hidden', 'false');
    textarea.style.borderColor = 'var(--danger)';
  }

  function clearCommentError(textarea) {
    var errEl = textarea._commentError;
    if (errEl) {
      errEl.textContent = '';
      errEl.setAttribute('aria-hidden', 'true');
    }
    textarea.style.borderColor = '';
  }

  // ── Error element management ─────────────────────────────────────────────────

  /**
   * Return (creating if necessary) the error <span> associated with an input.
   * The span is inserted immediately after the input element so it sits
   * beneath the score field in the criteria-grid layout.
   */
  function getOrCreateErrorEl(input) {
    // Cache on the DOM node to avoid repeated querySelector calls.
    if (input._validationError) return input._validationError;

    const span = document.createElement('span');
    span.className = 'score-validation-error';
    span.setAttribute('role', 'alert');
    span.setAttribute('aria-live', 'polite');

    // Insert after the input (before any decimal-warning span that may exist)
    input.after(span);
    input._validationError = span;
    return span;
  }

  /**
   * Display an error message on the input and apply the danger border.
   */
  function showError(input, message) {
    const errEl = getOrCreateErrorEl(input);
    errEl.textContent = message;
    errEl.setAttribute('aria-hidden', 'false');

    input.classList.add('score-input-invalid');
    input.setAttribute('aria-invalid', 'true');
  }

  /**
   * Clear any error state on the input.
   */
  function clearError(input) {
    const errEl = input._validationError;
    if (errEl) {
      errEl.textContent = '';
      errEl.setAttribute('aria-hidden', 'true');
    }
    input.classList.remove('score-input-invalid');
    input.removeAttribute('aria-invalid');
  }

  // ── Core validation logic ────────────────────────────────────────────────────

  /**
   * validateScore(input, [isRequired])
   *
   * Validates a single score input.
   * Returns true if the value is valid, false otherwise.
   *
   * Rules:
   *   - If required (default: true) and empty → error
   *   - If not empty and not a finite number → error
   *   - If not a whole number (decimal) → error
   *   - If outside 1–5 → error
   *   - Otherwise → clear any existing error, return true
   */
  function validateScore(input, isRequired) {
    if (isRequired === undefined) isRequired = true;

    const raw   = (input.value || '').trim();
    const label = FIELD_LABELS[input.name] || input.name;

    // Empty field
    if (raw === '') {
      if (isRequired) {
        showError(input, label + ' is required — enter a score from 1 to 5.');
        return false;
      }
      // Optional and empty is fine
      clearError(input);
      return true;
    }

    const n = Number(raw);

    // Not a number at all
    if (!Number.isFinite(n)) {
      showError(input, label + ' must be a number between 1 and 5.');
      return false;
    }

    // Decimal value
    if (!Number.isInteger(n)) {
      showError(input, label + ' must be a whole number (received ' + raw + ').');
      return false;
    }

    // Out of range
    if (n < SCORE_MIN || n > SCORE_MAX) {
      showError(input, label + ' must be between 1 and 5 (received ' + raw + ').');
      return false;
    }

    // All good
    clearError(input);
    return true;
  }

  // ── Form-level validation ────────────────────────────────────────────────────

  /**
   * isLeadingVisible()
   * Returns true if the leading-bucket section is currently shown.
   * Mirrors the leadingShouldBeVisible / setLeadingVisibility logic
   * already in new.ejs without duplicating it — reads the DOM state instead.
   */
  function isLeadingVisible() {
    const bucket = document.getElementById('leading-bucket');
    if (!bucket) return false;
    return !bucket.classList.contains('is-hidden');
  }

  /**
   * validateAllScores([options])
   *
   * Validates every visible .criteria-input on the page.
   * Leading People fields are only required when that bucket is visible.
   *
   * Returns an object: { valid: boolean, firstInvalidInput: Element|null }
   */
  function validateAllScores(options) {
    options = options || {};
    const inputs = document.querySelectorAll('input.criteria-input');
    const leadingVisible = isLeadingVisible();

    // Guard: block submit if no scores have been entered at all
    const anyFilled = Array.from(inputs).some(function (inp) {
      return (inp.value || '').trim() !== '';
    });
    if (!anyFilled) {
      // Show a top-level message rather than per-field errors
      return { valid: false, firstInvalidInput: inputs[0] || null, noScores: true };
    }

    let allValid = true;
    let firstInvalid = null;

    inputs.forEach(function (input) {
      const isLeading  = LEADING_FIELDS.indexOf(input.name) !== -1;
      // Leading fields are required only when that bucket is shown.
      // All other score fields are always required once a staff member is selected.
      const isRequired = isLeading ? leadingVisible : true;

      // Skip leading fields entirely when the bucket is hidden
      // (setLeadingVisibility already cleared their values)
      if (isLeading && !leadingVisible) {
        clearError(input);
        return;
      }

      const valid = validateScore(input, isRequired);
      if (!valid) {
        allValid = false;
        if (!firstInvalid) firstInvalid = input;
      }
    });

    return { valid: allValid, firstInvalidInput: firstInvalid };
  }

  // ── Live per-input validation (called on input/change events) ────────────────

  /**
   * handleInputChange(input)
   * Called by the existing input/change listeners already on each .criteria-input.
   * Only shows an error if the field has already been touched (has a non-empty value
   * or has previously shown an error) so we don't yell at untouched fields.
   */
  function handleInputChange(input) {
    const raw = (input.value || '').trim();
    const hadError = input.classList.contains('score-input-invalid');

    // Validate eagerly if the field already has an error (re-check on every keystroke
    // so the error disappears the moment the value becomes valid).
    // Also validate if the user has actually entered something.
    if (hadError || raw !== '') {
      const isLeading  = LEADING_FIELDS.indexOf(input.name) !== -1;
      const isRequired = isLeading ? isLeadingVisible() : true;
      validateScore(input, isRequired);
    }
  }

  // ── Comment validation ────────────────────────────────────────────────────────

  /**
   * validateAllComments()
   *
   * For every visible score input that has a valid, non-3 score,
   * checks that its paired comment textarea is not empty.
   *
   * Returns { valid: boolean, firstInvalidInput: Element|null }
   * where firstInvalidInput is the offending textarea (so we can scroll to it).
   */
  function validateAllComments() {
    var allInputs = document.querySelectorAll('input[type="number"][data-comment]');
    var leadingVisible = isLeadingVisible();
    var allValid = true;
    var firstInvalid = null;

    allInputs.forEach(function (input) {
      var isLeading = LEADING_FIELDS.indexOf(input.name) !== -1;
      if (isLeading && !leadingVisible) return;

      var commentFieldName = COMMENT_FIELDS[input.name];
      if (!commentFieldName) return;

      var raw = (input.value || '').trim();
      if (raw === '') return; // blank score — score validation handles this

      var n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return; // invalid score — score validation handles this
      if (n === 3) return; // score of 3 — comment is optional

      // Score is 1, 2, 4, or 5 — comment is required
      var textarea = document.querySelector('textarea[name="' + commentFieldName + '"]');
      if (!textarea) return;

      var commentText = (textarea.value || '').trim();
      if (!commentText) {
        var label = FIELD_LABELS[input.name] || input.name;
        showCommentError(textarea, label + ': a comment is required for scores of 1, 2, 4, or 5.');
        if (!firstInvalid) firstInvalid = textarea;
        allValid = false;
      } else {
        clearCommentError(textarea);
      }
    });

    return { valid: allValid, firstInvalidInput: firstInvalid };
  }

  // ── Submit guard ─────────────────────────────────────────────────────────────

  /**
   * attachSubmitGuard(form, [options])
   *
   * Wires a submit event listener onto the review form that:
   *   1. Validates all score inputs.
   *   2. If any are invalid, prevents submission and scrolls to the first error.
   *   3. Shows a summary message above the submit button.
   *
   * options.summaryContainerId — id of the element to write the summary into.
   *                              Defaults to 'validation-summary'.
   * options.submitBtnId        — id of the submit button (to re-enable on re-check).
   *                              Defaults to 'submit-review-btn'.
   */
  function attachSubmitGuard(form, options) {
    options = options || {};
    const summaryId   = options.summaryContainerId || 'validation-summary';
    const submitBtnId = options.submitBtnId        || 'submit-review-btn';

    if (!form) return;

    form.addEventListener('submit', function (evt) {
      var scoreResult   = validateAllScores();
      var commentResult = validateAllComments();

      if (scoreResult.valid && commentResult.valid) {
        hideSummary(summaryId);
        return;
      }

      evt.preventDefault();
      evt.stopPropagation();

      if (scoreResult.noScores) {
        var el = document.getElementById(summaryId);
        if (el) {
          el.textContent = 'No scores have been entered yet — please score at least one criterion before submitting.';
          el.style.display = 'block';
          el.setAttribute('aria-hidden', 'false');
        }
        var firstEl = scoreResult.firstInvalidInput;
        if (firstEl) { expandContainingBucket(firstEl); scrollToFirstError(firstEl); }
        return;
      }

      var invalidScoreCount   = form.querySelectorAll('input.criteria-input.score-input-invalid').length;
      var invalidCommentCount = form.querySelectorAll('textarea[style*="var(--danger)"]').length;
      showSummary(summaryId, invalidScoreCount, invalidCommentCount);

      // Scroll to the first error (score errors take priority).
      var firstInvalid = scoreResult.firstInvalidInput || commentResult.firstInvalidInput;
      if (firstInvalid) {
        expandContainingBucket(firstInvalid);
        scrollToFirstError(firstInvalid);
      }
    });
  }

  // ── Summary banner ────────────────────────────────────────────────────────────

  function showSummary(containerId, invalidScoreCount, invalidCommentCount) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var parts = [];
    if (invalidScoreCount > 0) {
      parts.push(invalidScoreCount + (invalidScoreCount === 1 ? ' score needs' : ' scores need') + ' to be filled in');
    }
    if (invalidCommentCount > 0) {
      parts.push(invalidCommentCount + (invalidCommentCount === 1 ? ' comment is' : ' comments are') + ' required for non-average scores (1, 2, 4, or 5)');
    }
    el.textContent = parts.join(' · ') + ' before you can submit.';
    el.style.display = 'block';
    el.setAttribute('aria-hidden', 'false');
  }

  function hideSummary(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * If the input sits inside a collapsed .bucket-card, expand it so the
   * error is visible when we scroll to it.
   */
  function expandContainingBucket(input) {
    var card = input.closest('.bucket-card');
    if (!card) return;

    var body = card.querySelector('.bucket-body');
    var toggleBtn = card.querySelector('.bucket-toggle');

    if (body && body.style.display === 'none') {
      body.style.display = '';
      if (toggleBtn) {
        toggleBtn.textContent = '−';
        toggleBtn.setAttribute('aria-expanded', 'true');
      }
    }
  }

  /**
   * Scroll the first invalid input into view with a comfortable offset,
   * then focus it so keyboard users land in the right place.
   */
  function scrollToFirstError(input) {
    // Use scrollIntoView with a block: 'center' so the sticky header doesn't
    // cover the field; then nudge upward by the nav height via scrollBy.
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  global.ReviewValidation = {
    validateScore:        validateScore,
    validateAllScores:    validateAllScores,
    validateAllComments:  validateAllComments,
    clearCommentError:    clearCommentError,
    handleInputChange:    handleInputChange,
    attachSubmitGuard:    attachSubmitGuard,
  };

})(window);
