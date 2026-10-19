(() => {
  if (window.__resumepilot) return;
  window.__resumepilot = true;
  console.log('ResumePilot loaded on', location.href);
  const JOB_SITE = /careers?|jobs?|apply|myworkdayjobs|workday|greenhouse|lever\.co|ashbyhq|smartrecruiters|icims|taleo|successfactors|oraclecloud|workable|jobvite|recruit|talent|hire/i;
  const MIN_CONF = 0.5;
  const FIELD_SEL = 'input:not([type=hidden]), textarea, select, button[aria-haspopup], [role=combobox]';
  const seen = new Set();
  let running = false;
  let timer = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const strip = s => clean(s).replace(/\*/g, '').trim();
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  }

  function deepAll(root, sel, out = []) {
    root.querySelectorAll(sel).forEach(e => out.push(e));
    root.querySelectorAll('*').forEach(e => e.shadowRoot && deepAll(e.shadowRoot, sel, out));
    return out;
  }

  const byId = (el, id) =>
    (el.getRootNode().getElementById ? el.getRootNode().getElementById(id) : null) || document.getElementById(id);

  function labelFor(el) {
    if (el.labels && el.labels.length) {
      const t = strip([...el.labels].map(l => l.innerText).join(' '));
      if (t) return t;
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = strip(lb.split(/\s+/).map(id => (byId(el, id) || {}).innerText || '').join(' '));
      if (t) return t;
    }
    const al = el.getAttribute('aria-label');
    if (al) return strip(al);
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      if (node.querySelectorAll(FIELD_SEL).length > 1) break;
      const lab = node.querySelector('label, legend, [class*="label" i]');
      if (lab) { const t = strip(lab.innerText); if (t) return t; }
    }
    if (el.placeholder) return strip(el.placeholder);
    return strip(el.name || el.id);
  }

  const optionLabel = el =>
    strip((el.labels && el.labels[0] && el.labels[0].innerText) ||
          (el.closest('label') && el.closest('label').innerText) ||
          (el.nextElementSibling && el.nextElementSibling.innerText) ||
          el.getAttribute('aria-label') || el.value);

  function groupLabel(radios) {
    const first = radios[0];
    const g = first.closest('fieldset, [role=radiogroup], [role=group]');
    if (g) {
      const lg = g.querySelector('legend');
      if (lg && strip(lg.innerText)) return strip(lg.innerText);
      const lb = g.getAttribute('aria-labelledby');
      if (lb) {
        const t = strip(lb.split(/\s+/).map(id => (byId(g, id) || {}).innerText || '').join(' '));
        if (t) return t;
      }
      if (g.getAttribute('aria-label')) return strip(g.getAttribute('aria-label'));
    }
    const opts = radios.map(optionLabel);
    let node = first.parentElement;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      if (!radios.every(r => node.contains(r))) continue;
      const lines = node.innerText.split('\n').map(strip).filter(l => l && !opts.includes(l));
      if (lines.length) return lines[0];
    }
    return '';
  }

  // ---------- scan ----------
  function scanPage() {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(h => strip(h.innerText));
    const sectionOf = el => {
      let s = '';
      for (const h of headings) {
        if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) s = strip(h.innerText);
        else break;
      }
      return s;
    };

    const els = deepAll(document, FIELD_SEL).filter((e, i, a) => a.indexOf(e) === i);
    const fields = [];
    const refs = [];
    const seenGroups = new Set();

    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (tag === 'input' && ['submit', 'reset', 'image', 'button', 'password'].includes(type)) continue;
      if (el.closest('header, nav, [data-automation-id=header]')) continue;
      if (el.disabled) continue;
      const loose = ['radio', 'checkbox', 'file'].includes(type);
      if (!loose && !isVisible(el)) continue;

      const base = {
        tag, type,
        id: el.id || '',
        name: el.name || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.placeholder || '',
        section: sectionOf(el),
      };

      if (type === 'radio') {
        const key = el.name || el.id;
        if (seenGroups.has(key)) continue;
        seenGroups.add(key);
        const radios = els.filter(r => r.type === 'radio' && (el.name ? r.name === el.name : r === el));
        fields.push({
          ...base, kind: 'radio-group', label: groupLabel(radios),
          required: radios.some(r => r.required || r.getAttribute('aria-required') === 'true'),
          options: radios.map(r => ({ label: optionLabel(r), value: r.value, checked: r.checked })),
        });
        refs.push(radios);
        continue;
      }

      const label = labelFor(el);
      if (!label && !base.id && !base.name) continue;

      let kind = 'text';
      if (tag === 'select') kind = 'select';
      else if (tag === 'textarea') kind = 'textarea';
      else if (type === 'checkbox') kind = 'checkbox';
      else if (type === 'file') kind = 'file';
      else if (tag === 'button' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) kind = 'custom-dropdown';

      const f = {
        ...base, kind, label,
        required: el.required || el.getAttribute('aria-required') === 'true' ||
                  /required/i.test(el.getAttribute('aria-label') || ''),
        value: kind === 'custom-dropdown' ? strip(el.innerText || el.value) : (el.value || ''),
      };
      if (kind === 'select') f.options = [...el.options].slice(0, 40).map(o => ({ label: strip(o.text), value: o.value }));
      fields.push(f);
      refs.push(el);
    }
    return { fields, refs };
  }

  // ---------- fill ----------
  function setNative(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const mark = el => { el.style.outline = '2px solid #34a853'; el.dataset.rpFilled = '1'; };

  function matchText(candidates, getText, want) {
    const w = norm(want);
    if (!w) return null;
    return candidates.find(c => norm(getText(c)) === w) ||
           candidates.find(c => { const t = norm(getText(c)); return t && (t.includes(w) || w.includes(t)); }) ||
           null;
  }

  async function pickDropdown(btn, value, current) {
    if (current && !/^(select|choose|please|--)/i.test(current)) return false; // already has a real value
    btn.click();
    await sleep(450);
    const opts = [...document.querySelectorAll(
      '[role=option], [role=listbox] li, [data-automation-id=promptOption], ul[role=listbox] > li'
    )].filter(isVisible);
    const hit = matchText(opts, o => o.innerText, value);
    if (hit) {
      hit.click();
      await sleep(250);
      mark(btn);
      return true;
    }
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  async function fillOne(f, ref, value) {
    const v = String(value);
    if (f.kind === 'text' || f.kind === 'textarea') {
      if (ref.value || ref.dataset.rpFilled) return false;
      if ((f.placeholder || '').toLowerCase() === 'search') return false; // searchable dropdown, not handled yet
      setNative(ref, v);
      mark(ref);
      return true;
    }
    if (f.kind === 'select') {
      if (ref.value && ref.selectedIndex > 0) return false;
      const opt = matchText([...ref.options].filter(o => o.value !== ''), o => o.text, v);
      if (!opt) return false;
      setNative(ref, opt.value);
      mark(ref);
      return true;
    }
    if (f.kind === 'radio-group') {
      if (ref.some(r => r.checked)) return false;
      const idx = f.options.findIndex(o => norm(o.label) === norm(v));
      if (idx < 0) return false;
      ref[idx].click();
      mark(ref[idx]);
      return true;
    }
    if (f.kind === 'custom-dropdown') return pickDropdown(ref, v, f.value);
    return false;
  }

  function toast(msg, bad) {
    let t = document.getElementById('rp-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rp-toast';
      t.style.cssText = 'position:fixed;z-index:2147483647;bottom:16px;right:16px;padding:10px 14px;' +
        'border-radius:8px;font:13px system-ui,sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.documentElement.appendChild(t);
    }
    t.style.background = bad ? '#d93025' : '#188038';
    t.textContent = msg;
    clearTimeout(t._t);
    t._t = setTimeout(() => t.remove(), 6000);
  }

  // ---------- main loop ----------
  async function run(force) {
    if (running) return;
    running = true;
    try {
      const { enabled = true } = await chrome.storage.local.get('enabled');
      if (!enabled && !force) return;
      if (!force && !JOB_SITE.test(location.href)) return;

      const { fields, refs } = scanPage();
      const fillable = fields.filter(f => f.kind !== 'file' && f.kind !== 'checkbox');
      if (fillable.length < 3) return;

      const sig = fillable.map(f => f.id || f.name || f.label).join('|');
      if (!force && seen.has(sig)) return;
      seen.add(sig);

      toast('ResumePilot: reading this form…');
      const res = await chrome.runtime.sendMessage({ type: 'fill', url: location.href, fields });
      if (!res || !res.ok) throw new Error((res && res.error) || 'no response from backend');
    
      console.log('ResumePilot answers', res.data.answers);
      let n = 0;
      for (const a of res.data.answers) {
        if (a.value == null || a.value === '' || (a.confidence ?? 1) < MIN_CONF) continue;
        const f = fields[a.idx];
        const ref = refs[a.idx];
        if (!f || !ref) continue;
        try {
          const ok = await fillOne(f, ref, a.value);
          console.log('ResumePilot', ok ? 'FILLED' : 'SKIPPED', '|', f.label, '=', a.value, '|', f.kind, '| current value:', JSON.stringify(ref.value ?? ''));
          if (ok) n++;
        } catch (e) {
          console.warn('ResumePilot: could not fill', f.label, e);
        }
      }
      toast(`ResumePilot filled ${n} of ${fillable.length} fields. Review before submitting.`);
      chrome.storage.local.set({ lastRun: { host: location.host, filled: n, total: fillable.length, at: Date.now() } });
    } catch (e) {
      toast('ResumePilot: ' + e.message, true);
    } finally {
      running = false;
    }
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => run(false), 1500); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'fillNow') { seen.clear(); run(true); }
  });
})();