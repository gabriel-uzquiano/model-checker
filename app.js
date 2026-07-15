/**
 * Main application controller.
 * Wires together: parser, evaluator, graph renderer, and DOM.
 */

// ─── State ────────────────────────────────────────────────────────────────────
let formulaSlots = [];   // [{ id, ast, sig }]
let slotCounter  = 0;
const MAX_FORMULAS = 6;

// Combined signature across all slots (used by model UI + graph)
let currentSig = null;
// First valid AST (used by graph)
let currentAst = null;

// ─── Theme toggle ─────────────────────────────────────────────────────────────
(function () {
  const btn  = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let theme = prefersDark ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);
  setThemeIcon(btn, theme);
  if (btn) {
    btn.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      setThemeIcon(btn, theme);
    });
  }
  function setThemeIcon(btn, theme) {
    if (!btn) return;
    btn.innerHTML = theme === 'dark'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
})();

// ─── Help panel ───────────────────────────────────────────────────────────────
function toggleHelp(e) {
  if (e) e.preventDefault();
  const panel = document.getElementById('help-panel');
  panel.hidden = !panel.hidden;
}

// ─── Symbol insertion ─────────────────────────────────────────────────────────
let lastFocusedInput = null;

function insertSym(sym) {
  const input = lastFocusedInput || document.querySelector('.formula-input');
  if (!input) return;
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  input.value = input.value.slice(0, start) + sym + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + sym.length;
  input.focus();
  input.dispatchEvent(new Event('input'));
}

// ─── Example setter ───────────────────────────────────────────────────────────
function setExample(formula) {
  const input = lastFocusedInput || document.querySelector('.formula-input');
  if (!input) return;
  input.value = formula;
  input.dispatchEvent(new Event('input'));
}

// ─── Subscript helper ─────────────────────────────────────────────────────────
function toSubscript(n) {
  return String(n).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[+d]).join('');
}

// ─── Multi-formula slot management ───────────────────────────────────────────
function addFormulaSlot(initialValue) {
  if (formulaSlots.length >= MAX_FORMULAS) return;
  const id = ++slotCounter;
  formulaSlots.push({ id, ast: null, sig: null });

  const list = document.getElementById('formula-list');
  const wrap = document.createElement('div');
  wrap.className = 'formula-slot';
  wrap.dataset.slotId = id;

  const label = document.createElement('span');
  label.className = 'slot-label';
  wrap.appendChild(label);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'formula-input-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'formula-input';
  input.placeholder = 'e.g.  \u2200xPxy  or  \u2203x(Px \u2227 Qx)';
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (initialValue) input.value = initialValue;

  const statusEl = document.createElement('div');
  statusEl.className = 'parse-status';

  input.addEventListener('focus', () => { lastFocusedInput = input; });
  input.addEventListener('input', () => onSlotChange(id, input, statusEl));

  inputWrap.appendChild(input);
  inputWrap.appendChild(statusEl);
  wrap.appendChild(inputWrap);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-ghost btn-icon slot-remove';
  removeBtn.title = 'Remove formula';
  removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  removeBtn.addEventListener('click', () => removeFormulaSlot(id));
  wrap.appendChild(removeBtn);

  list.appendChild(wrap);
  renumberSlots();
  updateAddButton();

  input.focus();
  lastFocusedInput = input;

  if (initialValue) input.dispatchEvent(new Event('input'));
}

function removeFormulaSlot(id) {
  if (formulaSlots.length <= 1) return; // always keep at least one
  formulaSlots = formulaSlots.filter(s => s.id !== id);
  const el = document.querySelector(`.formula-slot[data-slot-id="${id}"]`);
  if (el) el.remove();
  if (lastFocusedInput && !document.contains(lastFocusedInput)) {
    lastFocusedInput = document.querySelector('.formula-input');
  }
  renumberSlots();
  updateAddButton();
  rebuildCombinedSig();
  updateModelUI();
  hideResult();
}

function renumberSlots() {
  document.querySelectorAll('.formula-slot').forEach((el, i) => {
    const lbl = el.querySelector('.slot-label');
    if (lbl) lbl.textContent = '\u03c6' + toSubscript(i + 1);
    // Hide remove button on the only remaining slot
    const btn = el.querySelector('.slot-remove');
    if (btn) btn.style.visibility = formulaSlots.length > 1 ? 'visible' : 'hidden';
  });
}

function updateAddButton() {
  const btn = document.getElementById('add-formula-btn');
  if (btn) btn.disabled = formulaSlots.length >= MAX_FORMULAS;
}

function onSlotChange(id, input, statusEl) {
  const raw  = input.value.trim();
  const slot = formulaSlots.find(s => s.id === id);
  if (!slot) return;

  if (!raw) {
    statusEl.textContent = '';
    statusEl.className   = 'parse-status';
    input.className      = 'formula-input';
    slot.ast = null;
    slot.sig = null;
  } else {
    try {
      slot.ast = parse(raw);
      slot.sig = collectSignature(slot.ast);
      statusEl.textContent = '\u2713 ' + prettyPrint(slot.ast);
      statusEl.className   = 'parse-status ok';
      input.className      = 'formula-input valid';
    } catch (e) {
      statusEl.textContent = '\u2717 ' + e.message;
      statusEl.className   = 'parse-status err';
      input.className      = 'formula-input invalid';
      slot.ast = null;
      slot.sig = null;
    }
  }
  rebuildCombinedSig();
  updateModelUI();
  hideResult();
}

function rebuildCombinedSig() {
  const combined = { consts: new Set(), predicates: {} };
  for (const slot of formulaSlots) {
    if (!slot.sig) continue;
    for (const c of slot.sig.consts) combined.consts.add(c);
    for (const [name, arity] of Object.entries(slot.sig.predicates)) {
      combined.predicates[name] = arity;
    }
  }
  const hasContent = combined.consts.size > 0 || Object.keys(combined.predicates).length > 0;
  currentSig = hasContent ? combined : null;
  currentAst = formulaSlots.find(s => s.ast)?.ast || null;
}

// ─── Collect free variables across all valid formula slots ────────────────────
function collectAllFreeVars() {
  const freeVars = new Set();
  for (const slot of formulaSlots) {
    if (!slot.ast) continue;
    const vars = collectFreeVars(slot.ast);
    for (const v of vars) freeVars.add(v);
  }
  return freeVars;
}

// ─── Domain input ─────────────────────────────────────────────────────────────
const domainInput = document.getElementById('domain-input');
domainInput.addEventListener('input', () => {
  updateDomainTags();
  updateModelUI();
  refreshGraph();
});

function parseDomain() {
  return domainInput.value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function updateDomainTags() {
  const tags   = document.getElementById('domain-tags');
  const domain = parseDomain();
  tags.innerHTML = '';
  domain.forEach(el => {
    const span = document.createElement('span');
    span.className   = 'domain-tag';
    span.textContent = el;
    tags.appendChild(span);
  });
}

// ─── Model UI builder ─────────────────────────────────────────────────────────
function updateModelUI() {
  const domain = parseDomain();
  if (!currentSig) {
    document.getElementById('constants-section').hidden  = true;
    document.getElementById('predicates-section').hidden = true;
    document.getElementById('relations-section').hidden  = true;
    buildVarAssignUI(new Set(), domain);
    return;
  }
  buildConstantsUI(currentSig.consts, domain);
  buildPredicatesUI(currentSig.predicates, domain);
  buildVarAssignUI(collectAllFreeVars(), domain);
  refreshGraph();
}

// ─── Variable assignment UI (s(x) = …) ──────────────────────────────────
function buildVarAssignUI(freeVars, domain) {
  const section = document.getElementById('var-assign-section');
  if (!section) return;
  const grid = document.getElementById('var-assign-grid');

  const varArray = [...freeVars].sort();
  if (varArray.length === 0) { section.hidden = true; return; }

  section.hidden = false;

  // Preserve existing selections
  const prev = {};
  grid.querySelectorAll('select[data-variable]').forEach(s => { prev[s.dataset.variable] = s.value; });
  grid.innerHTML = '';

  varArray.forEach(v => {
    const row     = document.createElement('div');
    row.className = 'constant-row'; // reuse same styling

    const nameSpan       = document.createElement('span');
    nameSpan.className   = 'constant-name';
    nameSpan.textContent = `α(${v}) =`;
    row.appendChild(nameSpan);

    const sel              = document.createElement('select');
    sel.className          = 'constant-select';
    sel.dataset.variable   = v;

    const blank         = document.createElement('option');
    blank.value         = '';
    blank.textContent   = '— pick —';
    sel.appendChild(blank);

    domain.forEach(el => {
      const opt       = document.createElement('option');
      opt.value       = el;
      opt.textContent = el;
      if (prev[v] ? el === prev[v] : false) opt.selected = true;
      sel.appendChild(opt);
    });
    row.appendChild(sel);
    grid.appendChild(row);
  });
}

// Read the current variable assignment from the UI
function buildVarAssignFromUI() {
  const env = {};
  document.querySelectorAll('select[data-variable]').forEach(sel => {
    if (sel.value) env[sel.dataset.variable] = sel.value;
  });
  return env;
}

function buildConstantsUI(consts, domain) {
  const section    = document.getElementById('constants-section');
  const grid       = document.getElementById('constants-grid');
  const constArray = [...consts].sort();

  // Preserve existing selections
  const prev = {};
  grid.querySelectorAll('select[data-constant]').forEach(s => { prev[s.dataset.constant] = s.value; });
  grid.innerHTML = '';

  if (constArray.length === 0) { section.hidden = true; return; }
  section.hidden = false;

  constArray.forEach(c => {
    const row      = document.createElement('div');
    row.className  = 'constant-row';

    const nameSpan       = document.createElement('span');
    nameSpan.className   = 'constant-name';
    nameSpan.textContent = `I(${c}) =`;
    row.appendChild(nameSpan);

    const sel         = document.createElement('select');
    sel.className     = 'constant-select';
    sel.id            = `const-${c}`;
    sel.dataset.constant = c;

    const blank         = document.createElement('option');
    blank.value         = '';
    blank.textContent   = '— pick —';
    sel.appendChild(blank);

    domain.forEach(el => {
      const opt       = document.createElement('option');
      opt.value       = el;
      opt.textContent = el;
      if (prev[c] ? el === prev[c] : el === c) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', refreshGraph);
    row.appendChild(sel);
    grid.appendChild(row);
  });
}

function buildPredicatesUI(predicates, domain) {
  const predSection = document.getElementById('predicates-section');
  const predGrid    = document.getElementById('predicates-grid');
  const relSection  = document.getElementById('relations-section');
  const relGrid     = document.getElementById('relations-grid');

  // Preserve checked state
  const prevPred = {}, prevRel = {};
  predGrid.querySelectorAll('input[data-key]').forEach(cb => { prevPred[cb.dataset.key] = cb.checked; });
  relGrid.querySelectorAll('input[data-key]').forEach(cb  => { prevRel[cb.dataset.key]  = cb.checked; });

  predGrid.innerHTML = '';
  relGrid.innerHTML  = '';

  const zero   = Object.entries(predicates).filter(([, ar]) => ar === 0);
  const unary  = Object.entries(predicates).filter(([, ar]) => ar === 1);
  const binary = Object.entries(predicates).filter(([, ar]) => ar === 2);
  const higher = Object.entries(predicates).filter(([, ar]) => ar >= 3);

  if (zero.length + unary.length > 0) {
    predSection.hidden = false;
    [...zero, ...unary].forEach(([name, arity]) => {
      const block      = document.createElement('div');
      block.className  = 'predicate-block';

      const pname      = document.createElement('div');
      pname.className  = 'predicate-name';
      pname.textContent = arity === 0 ? `${name}  (sentence letter)` : `I(${name})`;
      block.appendChild(pname);

      const checkGrid       = document.createElement('div');
      checkGrid.className   = 'checkbox-grid';

      if (arity === 0) {
        const key = `${name}:_zero`;
        checkGrid.appendChild(makeCheckbox(`pred-${name}-true`, key, `${name} is true`, prevPred[key]));
      } else {
        domain.forEach(el => {
          const key = `${name}:${el}`;
          checkGrid.appendChild(makeCheckbox(`pred-${name}-${el}`, key, el, prevPred[key]));
        });
      }
      block.appendChild(checkGrid);
      predGrid.appendChild(block);
    });
  } else {
    predSection.hidden = true;
  }

  if (binary.length > 0 || higher.length > 0) {
    relSection.hidden = false;

    // Binary relations — checkbox grid
    binary.forEach(([name]) => {
      const block     = document.createElement('div');
      block.className = 'relation-block';

      const pname      = document.createElement('div');
      pname.className  = 'predicate-name';
      pname.textContent = `I(${name})`;
      block.appendChild(pname);

      const checkGrid     = document.createElement('div');
      checkGrid.className = 'checkbox-grid';

      domain.forEach(a => {
        domain.forEach(b => {
          const key = `${name}:${a}:${b}`;
          checkGrid.appendChild(makeCheckbox(`rel-${name}-${a}-${b}`, key, `\u27e8${a},${b}\u27e9`, prevRel[key]));
        });
      });

      block.appendChild(checkGrid);
      relGrid.appendChild(block);
    });

    // n-ary relations (arity ≥ 3) — checkbox grid over all n-tuples
    higher.forEach(([name, arity]) => {
      const block     = document.createElement('div');
      block.className = 'relation-block';

      const pname      = document.createElement('div');
      pname.className  = 'predicate-name';
      pname.textContent = `I(${name})  (${arity}-place)`;
      block.appendChild(pname);

      const checkGrid     = document.createElement('div');
      checkGrid.className = 'checkbox-grid';

      // Generate all n-tuples from domain
      function cartesian(arr, n) {
        if (n === 1) return arr.map(el => [el]);
        return cartesian(arr, n - 1).flatMap(t => arr.map(el => [...t, el]));
      }
      cartesian(domain, arity).forEach(tuple => {
        const key    = `${name}:${tuple.join(':')}`;
        const lbl    = `\u27e8${tuple.join(',')}\u27e9`;
        const cbId   = `rel-${name}-${tuple.join('-')}`;
        checkGrid.appendChild(makeCheckbox(cbId, key, lbl, prevRel[key]));
      });

      block.appendChild(checkGrid);
      relGrid.appendChild(block);
    });
  } else {
    relSection.hidden = true;
  }
}

function makeCheckbox(id, dataKey, labelText, checked) {
  const label      = document.createElement('label');
  label.className  = 'checkbox-item';
  label.htmlFor    = id;

  const cb        = document.createElement('input');
  cb.type         = 'checkbox';
  cb.id           = id;
  cb.dataset.key  = dataKey;
  cb.checked      = !!checked;
  if (checked) label.classList.add('checked');

  cb.addEventListener('change', () => {
    label.classList.toggle('checked', cb.checked);
    refreshGraph();
  });

  label.appendChild(cb);
  label.appendChild(document.createTextNode(labelText));
  return label;
}

// ─── Build model from UI ──────────────────────────────────────────────────────
function buildModelFromUI() {
  const domain = parseDomain();
  const interp = {};

  document.querySelectorAll('select[data-constant]').forEach(sel => {
    if (sel.value) interp[sel.dataset.constant] = sel.value;
  });

  document.querySelectorAll('input[data-key]:checked').forEach(cb => {
    const key      = cb.dataset.key;
    const parts    = key.split(':');
    const predName = parts[0];
    if (parts[1] === '_zero') {
      interp[predName] = true;
    } else if (parts.length === 2) {
      // Unary: key = name:el
      if (!Array.isArray(interp[predName])) interp[predName] = [];
      interp[predName].push(parts[1]);
    } else {
      // Binary or n-ary: key = name:a:b[:c...]
      if (!Array.isArray(interp[predName])) interp[predName] = [];
      const tuple = parts.slice(1);
      interp[predName].push(tuple.length === 1 ? tuple[0] : tuple);
    }
  });

  return { domain, interp };
}

// ─── Graph refresh ────────────────────────────────────────────────────────────
function refreshGraph() {
  if (!currentSig) {
    renderGraph({ domain: parseDomain(), interp: {} }, { predicates: {}, consts: new Set() });
    return;
  }
  renderGraph(buildModelFromUI(), currentSig);
}

// ─── Run evaluation ───────────────────────────────────────────────────────────
function runEvaluation() {
  hideError();
  hideResult();

  const validSlots = formulaSlots.filter(s => s.ast !== null);
  if (validSlots.length === 0) {
    showError('No valid formula to evaluate. Enter at least one formula above.');
    return;
  }

  const domain = parseDomain();
  if (domain.length === 0) {
    showError('Domain is empty. Add at least one element (e.g. 1, 2, 3).');
    return;
  }

  const model = buildModelFromUI();
  if (currentSig) {
    const warnings = validateModel(model, currentSig);
    if (warnings.length > 0) {
      showError(warnings.join('\n'));
      return;
    }
  }

  // Collect variable assignment for open formulas
  const varAssign = buildVarAssignFromUI();

  // Check that every free variable across all valid slots has an assignment
  const allFree = collectAllFreeVars();
  const missing = [...allFree].filter(v => !varAssign[v]);
  if (missing.length > 0) {
    showError(
      `Variable assignment incomplete: α(${missing.join('), α(')}) has no value.\n` +
      `Use the Variable Assignment section to assign each free variable a domain element.`
    );
    return;
  }

  try {
    const results = validSlots.map(slot => ({
      formula    : prettyPrint(slot.ast),
      freeVars   : [...collectFreeVars(slot.ast)].sort(),
      result     : folEvaluate(slot.ast, model, varAssign)
    }));
    showMultiResult(results, varAssign);
    refreshGraph();
  } catch (e) {
    showError('Evaluation error: ' + e.message);
  }
}

function evaluate() { runEvaluation(); }

// ─── Result display ───────────────────────────────────────────────────────────
function showMultiResult(results, varAssign) {
  const section = document.getElementById('result-section');
  section.hidden = false;
  section.style.display = '';

  const multiDiv = document.getElementById('multi-results');
  multiDiv.innerHTML = '';

  // Per-formula blocks
  results.forEach(({ formula, freeVars, result }, i) => {
    const block = document.createElement('div');
    block.className = 'result-block';

    // Header row: label + formula + verdict
    const header = document.createElement('div');
    header.className = 'result-block-header';

    const lbl       = document.createElement('span');
    lbl.className   = 'result-block-label';
    lbl.textContent = '\u03c6' + toSubscript(i + 1);
    header.appendChild(lbl);

    const fml       = document.createElement('span');
    fml.className   = 'result-block-formula';
    fml.textContent = formula;
    header.appendChild(fml);

    const badge       = document.createElement('span');
    badge.className   = `verdict-badge ${result.value ? 'true' : 'false'}`;
    badge.textContent = result.value ? 'T' : 'F';
    header.appendChild(badge);

    block.appendChild(header);

    // If this formula has free variables, show the assignment used
    if (freeVars && freeVars.length > 0 && varAssign) {
      const assignNote       = document.createElement('div');
      assignNote.className   = 'assign-note';
      const assignText = freeVars
        .map(v => `α(${v}) = ${varAssign[v]}`)
        .join(',\u2002');
      assignNote.textContent = `under assignment: ${assignText}`;
      block.appendChild(assignNote);
    }

    // Steps toggle + container
    let stepsVisible = false;
    const toggleBtn       = document.createElement('button');
    toggleBtn.className   = 'btn btn-ghost btn-sm steps-toggle-btn';
    toggleBtn.textContent = 'Show steps';
    block.appendChild(toggleBtn);

    const stepsContainer     = document.createElement('div');
    stepsContainer.className = 'steps-container';
    stepsContainer.hidden    = true;
    buildSteps(result.steps, stepsContainer);
    block.appendChild(stepsContainer);

    toggleBtn.addEventListener('click', () => {
      stepsVisible = !stepsVisible;
      stepsContainer.hidden = !stepsVisible;
      toggleBtn.textContent = stepsVisible ? 'Hide steps' : 'Show steps';
    });

    multiDiv.appendChild(block);
  });

  // Consistency summary (only meaningful with 2+ formulas)
  const consistencyDiv = document.getElementById('consistency-verdict');
  if (results.length >= 2) {
    const allTrue   = results.every(r => r.result.value);
    const someTrue  = results.some(r => r.result.value);
    const someFalse = results.some(r => !r.result.value);

    let msg, cls;
    if (allTrue) {
      msg = 'Consistent \u2014 all formulas are true in this model.';
      cls = 'consistency-true';
    } else {
      msg = 'Inconsistent \u2014 not all formulas are true in this model.';
      cls = 'consistency-false';
    }
    consistencyDiv.textContent = msg;
    consistencyDiv.className   = 'consistency-verdict ' + cls;
    consistencyDiv.hidden      = false;
  } else {
    consistencyDiv.hidden = true;
  }
}

function buildSteps(steps, container) {
  steps.forEach(s => {
    // isRuleHeader: a labelled divider row (no formula, no value badge)
    if (s.isRuleHeader) {
      const div       = document.createElement('div');
      div.className   = 'step step-rule-header';
      const depth     = document.createElement('span');
      depth.className = 'step-depth';
      depth.textContent = '\u203a'.repeat(s.depth + 1);
      const label     = document.createElement('span');
      label.className = 'step-rule-label';
      label.textContent = s.reason;
      div.appendChild(depth);
      div.appendChild(label);
      container.appendChild(div);
      return;
    }

    const div       = document.createElement('div');
    div.className   = s.value === null ? 'step step-header' : 'step';

    const depth       = document.createElement('span');
    depth.className   = 'step-depth';
    depth.textContent = '\u203a'.repeat(s.depth + 1);

    const formulaCol     = document.createElement('div');
    formulaCol.className = 'step-formula';

    const formulaText     = document.createElement('div');
    formulaText.textContent = s.formula;

    const reasonText     = document.createElement('div');
    reasonText.className = 'step-reason';
    reasonText.textContent = s.reason;

    formulaCol.appendChild(formulaText);
    formulaCol.appendChild(reasonText);

    const val = document.createElement('span');
    if (s.value === null) {
      val.className   = 'step-value neutral';
      val.textContent = '';
    } else {
      val.className   = `step-value ${s.value ? 'true' : 'false'}`;
      val.textContent = s.value ? 'T' : 'F';
    }

    div.appendChild(depth);
    div.appendChild(formulaCol);
    div.appendChild(val);
    container.appendChild(div);
  });
}

function hideResult() {
  const s     = document.getElementById('result-section');
  s.hidden    = true;
  s.style.display = 'none';
  document.getElementById('multi-results').innerHTML = '';
  document.getElementById('consistency-verdict').hidden = true;
}

// ─── Error display ────────────────────────────────────────────────────────────
function showError(msg) {
  const sec     = document.getElementById('error-section');
  const msgEl   = document.getElementById('error-msg');
  // Support \n line breaks in error messages
  msgEl.innerHTML = '';
  msg.split('\n').forEach((line, i) => {
    if (i > 0) msgEl.appendChild(document.createElement('br'));
    msgEl.appendChild(document.createTextNode(line));
  });
  sec.hidden       = false;
  sec.style.display = '';
}

function hideError() {
  const s     = document.getElementById('error-section');
  s.hidden    = true;
  s.style.display = 'none';
}

// ─── Clear model ──────────────────────────────────────────────────────────────
function clearModel() {
  domainInput.value = '';
  document.getElementById('domain-tags').innerHTML      = '';
  document.getElementById('constants-section').hidden  = true;
  document.getElementById('predicates-section').hidden = true;
  document.getElementById('relations-section').hidden  = true;
  const vas = document.getElementById('var-assign-section');
  if (vas) { vas.hidden = true; document.getElementById('var-assign-grid').innerHTML = ''; }
  hideResult();
  hideError();
  refreshGraph();
}

// ─── Keyboard shortcut ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runEvaluation();
});

// ─── Shareable URL ────────────────────────────────────────────────────────────
// Encodes the current state (formulas + model) into the URL hash so the page
// can be bookmarked or linked with a pre-loaded example.

function encodeState() {
  try {
    const formulas = formulaSlots.map(s => {
      const el = document.querySelector(`.formula-slot[data-slot-id="${s.id}"] .formula-input`);
      return el ? el.value : '';
    }).filter(f => f.trim());

    const model = buildModelFromUI();

    // Collect checked predicate/relation state
    const interp = {};
    document.querySelectorAll('select[data-constant]').forEach(sel => {
      if (sel.value) interp[sel.dataset.constant] = sel.value;
    });
    document.querySelectorAll('input[data-key]:checked').forEach(cb => {
      const key   = cb.dataset.key;
      const parts = key.split(':');
      const name  = parts[0];
      if (parts[1] === '_zero') {
        interp[name] = true;
      } else if (parts.length === 2) {
        if (!Array.isArray(interp[name])) interp[name] = [];
        if (!interp[name].includes(parts[1])) interp[name].push(parts[1]);
      } else {
        if (!Array.isArray(interp[name])) interp[name] = [];
        const tuple = parts.slice(1);
        interp[name].push(tuple.length === 1 ? tuple[0] : tuple);
      }
    });

    // Collect variable assignment
    const varAssignState = {};
    document.querySelectorAll('select[data-variable]').forEach(sel => {
      if (sel.value) varAssignState[sel.dataset.variable] = sel.value;
    });

    const state = {
      f: formulas,
      d: model.domain,
      i: interp,
      s: varAssignState  // variable assignment
    };
    // Base64-encode for a compact, URL-safe hash (≈40% shorter than percent-encoding)
    const json   = JSON.stringify(state);
    const b64    = btoa(unescape(encodeURIComponent(json)));
    const hash   = '#v2:' + b64;
    history.replaceState(null, '', hash);
  } catch (e) {
    // silently ignore encode errors
  }
}

function decodeState() {
  try {
    const raw = window.location.hash.slice(1);
    if (!raw) return false;

    // Support both new Base64 format (v2:...) and old percent-encoded format
    let state;
    if (raw.startsWith('v2:')) {
      const json = decodeURIComponent(escape(atob(raw.slice(3))));
      state = JSON.parse(json);
    } else {
      state = JSON.parse(decodeURIComponent(raw));
    }

    // Restore formulas
    if (Array.isArray(state.f) && state.f.length > 0) {
      // Remove any existing slots
      while (formulaSlots.length > 0) {
        const id = formulaSlots[0].id;
        const el = document.querySelector(`.formula-slot[data-slot-id="${id}"]`);
        if (el) el.remove();
        formulaSlots = formulaSlots.filter(s => s.id !== id);
      }
      state.f.forEach((fStr, idx) => {
        addFormulaSlot(fStr);
      });
    }

    // Restore domain
    if (Array.isArray(state.d)) {
      domainInput.value = state.d.join(', ');
      updateDomainTags();
      updateModelUI(); // rebuild checkboxes/dropdowns based on current sigs
    }

    // Restore interpretations after a tick (so the UI elements exist)
    if (state.i) {
      setTimeout(() => {
        // Constants
        Object.entries(state.i).forEach(([name, val]) => {
          const sel = document.querySelector(`select[data-constant="${name}"]`);
          if (sel) sel.value = val;
        });
        // Predicates / relations: check the right boxes
        Object.entries(state.i).forEach(([name, val]) => {
          if (val === true) {
            const cb = document.querySelector(`input[data-key="${name}:_zero"]`);
            if (cb) { cb.checked = true; cb.closest('label')?.classList.add('checked'); }
          } else if (Array.isArray(val)) {
            val.forEach(entry => {
              const key = Array.isArray(entry)
                ? `${name}:${entry[0]}:${entry[1]}`
                : `${name}:${entry}`;
              const cb = document.querySelector(`input[data-key="${key}"]`);
              if (cb) { cb.checked = true; cb.closest('label')?.classList.add('checked'); }
            });
          }
        });
        // Variable assignment
        if (state.s && typeof state.s === 'object') {
          Object.entries(state.s).forEach(([varName, val]) => {
            const sel = document.querySelector(`select[data-variable="${varName}"]`);
            if (sel) sel.value = val;
          });
        }
        refreshGraph();
      }, 50);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Add a "Copy link" button to the header
function addShareButton() {
  const headerRight = document.querySelector('.header-right');
  if (!headerRight) return;
  const btn     = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm share-btn';
  btn.title     = 'Copy shareable link to this model and formulas';
  btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Copy link';
  btn.addEventListener('click', () => {
    encodeState();
    navigator.clipboard.writeText(window.location.href).then(() => {
      const orig = btn.innerHTML;
      btn.textContent = '\u2713 Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(() => {
      // Fallback: select the URL
      prompt('Copy this link:', window.location.href);
    });
  });
  headerRight.insertBefore(btn, headerRight.firstChild);
}

// ─── Init: create first slot + initial graph ──────────────────────────────────
addFormulaSlot();
addShareButton();
const loadedFromHash = decodeState();
if (!loadedFromHash) refreshGraph();

// ── Card-mode: ?card=formula|model|graph ──────────────────────────────────────
// When loaded inside an iframe with ?card=<name>, hides everything except the
// requested card(s) and applies compact padding.
//
// Supported values (comma-separated for multiple):
//   ?card=formula      — Formulas card only
//   ?card=model        — Model card only (domain, predicates, relations)
//   ?card=graph        — Model Graph card only
//   ?card=model,graph  — Model + Graph (no formula card)

(function applyCardMode() {
  const params = new URLSearchParams(location.search);
  if (!params.has('card')) return;

  const requested = new Set(
    params.get('card').split(',').map(s => s.trim().toLowerCase())
  );

  // Hide header and help panel
  const header    = document.querySelector('.app-header');
  const helpPanel = document.getElementById('help-panel');
  if (header)    header.hidden    = true;
  if (helpPanel) helpPanel.hidden = true;

  // Hide/show individual section cards
  const sectionMap = {
    formula: document.getElementById('formula-section'),
    model:   document.getElementById('model-section'),
    graph:   document.getElementById('graph-section'),
  };

  Object.entries(sectionMap).forEach(([name, el]) => {
    if (!el) return;
    if (requested.has(name)) {
      el.hidden = false;
      el.style.display = '';
    } else {
      el.hidden = true;
      el.style.display = 'none';
    }
  });

  // Hide result/error sections
  ['result-section', 'error-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.hidden = true; el.style.display = 'none'; }
  });

  // Column visibility — hide a column only if ALL its cards are hidden
  const colLeft  = document.querySelector('.col-left');
  const colRight = document.querySelector('.col-right');
  const wantsLeft  = requested.has('formula') || requested.has('model');
  const wantsRight = requested.has('graph');
  if (colLeft)  colLeft.hidden  = !wantsLeft;
  if (colRight) colRight.hidden = !wantsRight;

  // Single-column layout when only one side is shown
  const appMain = document.querySelector('.app-main');
  if (appMain && (!wantsLeft || !wantsRight)) {
    appMain.style.gridTemplateColumns = '1fr';
  }

  document.body.classList.add('card-mode');

  // ?zoom=0.75 — scale content down while keeping the iframe container full-size
  const zoom = parseFloat(params.get('zoom'));
  if (zoom > 0 && zoom < 1) {
    const target = appMain || document.body;
    // Scale from top-center of the body so centering is always correct
    document.body.style.transform       = `scale(${zoom})`;
    document.body.style.transformOrigin = 'top center';
    document.body.style.width           = `${(100 / zoom).toFixed(4)}%`;
    document.body.style.marginLeft      = `${((1 - 1/zoom) / 2 * 100).toFixed(4)}%`;
    document.body.style.overflow        = 'hidden';
    document.body.style.height          = `${(100 / zoom).toFixed(4)}vh`;
  }
})();
