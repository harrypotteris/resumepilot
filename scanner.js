(() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const strip = s => clean(s).replace(/\*/g, '').trim();
  const isVisible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const deepAll = (root, sel, out = []) => {
    root.querySelectorAll(sel).forEach(e => out.push(e));
    root.querySelectorAll('*').forEach(e => e.shadowRoot && deepAll(e.shadowRoot, sel, out));
    return out;
  };

  const PLATFORMS = {
    workday: /myworkdayjobs|workday/, greenhouse: /greenhouse\.io/, lever: /lever\.co/,
    ashby: /ashbyhq/, smartrecruiters: /smartrecruiters/, icims: /icims/,
    oracle: /oraclecloud/, taleo: /taleo/, successfactors: /successfactors/,
  };
  const platform = Object.keys(PLATFORMS).find(k => PLATFORMS[k].test(location.hostname)) || 'unknown';

  const FIELD_SEL = 'input:not([type=hidden]), textarea, select, button[aria-haspopup], [role=combobox]';

  const byId = (el, id) => (el.getRootNode().getElementById ? el.getRootNode().getElementById(id) : null) || document.getElementById(id);

  function labelFor(el) {
    if (el.labels && el.labels.length) {
      const t = strip([...el.labels].map(l => l.innerText).join(' '));
      if (t) return [t, 'label-for'];
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = strip(lb.split(/\s+/).map(id => (byId(el, id) || {}).innerText || '').join(' '));
      if (t) return [t, 'aria-labelledby'];
    }
    const al = el.getAttribute('aria-label');
    if (al) return [strip(al), 'aria-label'];
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
      if (node.querySelectorAll(FIELD_SEL).length > 1) break;
      const lab = node.querySelector('label, legend, [class*="label" i]');
      if (lab) { const t = strip(lab.innerText); if (t) return [t, 'ancestor-label']; }
    }
    if (el.placeholder) return [strip(el.placeholder), 'placeholder'];
    return [strip(el.name || el.id), 'name-or-id'];
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
      if (lg && strip(lg.innerText)) return [strip(lg.innerText), 'legend'];
      const lb = g.getAttribute('aria-labelledby');
      if (lb) {
        const t = strip(lb.split(/\s+/).map(id => (byId(g, id) || {}).innerText || '').join(' '));
        if (t) return [t, 'group-aria-labelledby'];
      }
      if (g.getAttribute('aria-label')) return [strip(g.getAttribute('aria-label')), 'group-aria-label'];
    }
    const opts = radios.map(optionLabel);
    let node = first.parentElement;
    for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
      if (!radios.every(r => node.contains(r))) continue;
      const lines = node.innerText.split('\n').map(strip).filter(l => l && !opts.includes(l));
      if (lines.length) return [lines[0], 'ancestor-text'];
    }
    return ['', 'none'];
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role=heading]')].filter(h => strip(h.innerText));
  const sectionOf = el => {
    let s = '';
    for (const h of headings) {
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) s = strip(h.innerText);
      else break;
    }
    return s;
  };

  const selectorOf = el =>
    el.id ? '#' + CSS.escape(el.id) :
    el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : '';

  const els = deepAll(document, FIELD_SEL).filter((e, i, a) => a.indexOf(e) === i);
  const fields = [];
  const seenGroups = new Set();

  for (const el of els) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && ['submit', 'reset', 'image', 'button'].includes(type)) continue;
    if (el.closest('header, nav, [data-automation-id=header]')) continue;
    const loose = ['radio', 'checkbox', 'file'].includes(type);
    if (!loose && !isVisible(el)) continue;

    const base = {
      tag, type,
      id: el.id || '',
      name: el.name || '',
      automationId: el.getAttribute('data-automation-id') || el.getAttribute('data-testid') || el.getAttribute('data-qa') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      placeholder: el.placeholder || '',
      section: sectionOf(el),
      selector: selectorOf(el),
    };

    if (type === 'radio') {
      const key = el.name || el.id;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      const radios = els.filter(r => r.type === 'radio' && r.name === el.name);
      const [label, labelSource] = groupLabel(radios);
      fields.push({
        ...base, kind: 'radio-group', label, labelSource,
        required: radios.some(r => r.required || r.getAttribute('aria-required') === 'true'),
        options: radios.map(r => ({ label: optionLabel(r), value: r.value, id: r.id, checked: r.checked })),
      });
      continue;
    }

    const [label, labelSource] = labelFor(el);
    if (!label && !base.id && !base.name) continue;

    let kind = 'text';
    if (tag === 'select') kind = 'select';
    else if (tag === 'textarea') kind = 'textarea';
    else if (type === 'checkbox') kind = 'checkbox';
    else if (type === 'file') kind = 'file';
    else if (tag === 'button' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup')) kind = 'custom-dropdown';

    const f = {
      ...base, kind, label, labelSource,
      required: el.required || el.getAttribute('aria-required') === 'true' ||
                /required/i.test(el.getAttribute('aria-label') || ''),
      value: kind === 'custom-dropdown' ? strip(el.innerText || el.value) : (el.value || ''),
    };
    if (kind === 'select') f.options = [...el.options].slice(0, 40).map(o => ({ label: strip(o.text), value: o.value }));
    fields.push(f);
  }

  return {
    url: location.href,
    host: location.hostname,
    platform,
    title: document.title,
    isTop: window === window.top,
    fields,
  };
})();