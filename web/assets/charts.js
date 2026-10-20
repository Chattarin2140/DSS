/* Lightweight SVG charts for the Supply Chain DSS (no dependencies).
   Mark specs: bars <= 24px with a 4px rounded data-end (square at the baseline), solid hairline
   grid/axes, 2px surface gaps between stacked segments, dots r=4 with a 2px surface ring.
   Every label is inserted with textContent. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, str, attrs) {
    const t = s('text', attrs, parent);
    t.textContent = str;
    return t;
  }

  let ctx;
  function measure(str, size = 12, weight = 400) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
    return ctx.measureText(String(str)).width;
  }
  function fit(str, width, size) {
    str = String(str);
    if (measure(str, size) <= width) return str;
    while (str.length > 1 && measure(str + '…', size) > width) str = str.slice(0, -1);
    return str + '…';
  }
  const pctS = v => Math.round(v * 100) + '%';

  // resolve "var(--x)" to its current hex so in-segment labels can pick white or ink
  function resolve(c) {
    const m = /var\((--[\w-]+)\)/.exec(c);
    return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : c;
  }
  function lum(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const [r, g, b] = [0, 2, 4].map(i => {
      const v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function inkOn(c) {
    const hex = resolve(c);
    if (!/^#[0-9a-f]{3,6}$/i.test(hex)) return 'on-light';
    const L = lum(hex);
    return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0533 ? 'on-dark' : 'on-light';
  }

  // ---------- tooltip (one shared element) ----------
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);

  function showTip(evt, title, rows) {
    tip.replaceChildren();
    const t = document.createElement('div');
    t.className = 'tt-title';
    t.textContent = title;
    tip.appendChild(t);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'tt-row';
      const key = document.createElement('i');
      key.className = 'tt-key';
      if (r.color) key.style.background = r.color; else key.style.visibility = 'hidden';
      const v = document.createElement('b');
      v.textContent = r.value;
      const l = document.createElement('span');
      l.textContent = r.label || '';
      row.append(key, v, l);
      tip.appendChild(row);
    }
    tip.classList.add('on');
    let x, y;
    if (evt.type && evt.type.startsWith('pointer')) { x = evt.clientX; y = evt.clientY; }
    else { const b = evt.currentTarget.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    const r = tip.getBoundingClientRect(), pad = 14;
    let left = x + pad, top = y + pad;
    if (left + r.width > innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > innerHeight - 8) top = y - r.height - pad;
    tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }
  function hideTip() { tip.classList.remove('on'); }
  function bindTip(node, get) {
    const on = e => { const [title, rows] = get(); showTip(e, title, rows); node.classList.add('hover'); };
    const off = () => { hideTip(); node.classList.remove('hover'); };
    node.addEventListener('pointerenter', on);
    node.addEventListener('pointermove', on);
    node.addEventListener('pointerleave', off);
    node.addEventListener('focus', on);
    node.addEventListener('blur', off);
  }

  function legend(items, kind = 'rect') {
    const box = document.createElement('div');
    box.className = 'legend';
    for (const it of items) {
      const item = document.createElement('span');
      item.className = 'lg-item';
      const sw = document.createElement('i');
      sw.className = 'lg-sw ' + kind;
      sw.style.background = it.color;
      item.appendChild(sw);
      if (it.icon) {
        const ic = document.createElement('b');
        ic.className = 'lg-ic';
        ic.textContent = it.icon;
        item.appendChild(ic);
      }
      const t = document.createElement('span');
      t.textContent = it.label;
      item.appendChild(t);
      box.appendChild(item);
    }
    return box;
  }

  function empty(el) {
    const d = document.createElement('div');
    d.className = 'empty-viz';
    d.textContent = 'ไม่มีข้อมูลตามตัวกรองนี้';
    el.appendChild(d);
  }

  // horizontal bar: rounded at the data end, square at the baseline
  function barPath(x, y, w, h, r = 4) {
    r = Math.min(r, w, h / 2);
    return `M${x},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x}Z`;
  }

  /* items: [{label, value, color?, dim?, strong?, extra?:[{label,value}]}] */
  function hbar(el, items, o = {}) {
    el.replaceChildren();
    if (!items.length) return empty(el);
    const fmt = o.fmt || (v => v.toLocaleString());
    if (o.legend) el.appendChild(legend(o.legend));
    const W = Math.max(el.clientWidth, 280), fs = 13;
    const rowH = o.rowH || 32, barH = Math.min(o.barH || 16, 24);
    const labW = Math.min(Math.max(...items.map(d => measure(d.label, fs, d.strong ? 600 : 400))) + 14, W * 0.4);
    const valW = Math.max(...items.map(d => measure(fmt(d.value), fs, 600))) + 12;
    const x0 = labW, plotW = Math.max(W - labW - valW, 40);
    const max = o.max || Math.max(...items.map(d => d.value)) || 1;
    const H = items.length * rowH + 4;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'group', 'aria-label': o.label || '' }, el);
    items.forEach((d, i) => {
      const y = 2 + i * rowH, cy = y + rowH / 2, color = d.color || o.color || 'var(--s1)';
      const g = s('g', { class: 'mark' + (d.dim ? ' dim' : ''), tabindex: 0, role: 'img', 'aria-label': `${d.label}: ${fmt(d.value)}` }, svg);
      s('rect', { x: 0, y, width: W, height: rowH, rx: 6, class: 'hit' }, g);
      text(g, fit(d.label, labW - 14, fs), { x: labW - 10, y: cy, class: 'lab' + (d.strong ? ' b' : ''), 'text-anchor': 'end', 'dominant-baseline': 'central' });
      const w = Math.max((Math.max(d.value, 0) / max) * plotW, 2);
      s('path', { d: barPath(x0, cy - barH / 2, w, barH), class: 'bar' }, g).style.fill = color;
      text(g, fmt(d.value), { x: x0 + w + 6, y: cy, class: 'val', 'dominant-baseline': 'central' });
      bindTip(g, () => [d.label, [{ value: fmt(d.value), label: o.valueLabel || '', color }, ...(d.extra || [])]]);
    });
    s('line', { x1: x0, x2: x0, y1: 0, y2: H, class: 'axis' }, svg);
  }

  /* rows: [{label, values:{key:n}}], keys: [{key,label,color,icon?}] — 100% stacked horizontal */
  function stack(el, rows, keys, o = {}) {
    el.replaceChildren();
    if (!rows.length) return empty(el);
    el.appendChild(legend(keys));
    const fmtV = o.fmt || (v => v.toLocaleString());
    const W = Math.max(el.clientWidth, 280), fs = 13, rowH = o.rowH || 38, barH = Math.min(o.barH || 22, 24), gap = 2;
    const tot = r => keys.reduce((a, k) => a + (r.values[k.key] || 0), 0);
    const totLbl = r => fmtV(tot(r)) + (o.unit ? ' ' + o.unit : '');
    const labW = Math.min(Math.max(...rows.map(r => measure(r.label, fs))) + 14, W * 0.36);
    const totW = Math.max(...rows.map(r => measure(totLbl(r), 12, 500))) + 14;
    const plotW = Math.max(W - labW - totW, 60);
    const H = rows.length * rowH + 4;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'group', 'aria-label': o.label || '' }, el);
    rows.forEach((r, i) => {
      const y = 2 + i * rowH, cy = y + rowH / 2, T = tot(r) || 1;
      text(svg, fit(r.label, labW - 14, fs), { x: labW - 10, y: cy, class: 'lab', 'text-anchor': 'end', 'dominant-baseline': 'central' });
      const segs = keys.filter(k => (r.values[k.key] || 0) > 0);
      let x = labW;
      segs.forEach((k, j) => {
        const v = r.values[k.key], full = (v / T) * plotW, last = j === segs.length - 1;
        const w = Math.max(full - (last ? 0 : gap), 1);
        const g = s('g', { class: 'mark', tabindex: 0, role: 'img', 'aria-label': `${r.label} · ${k.label}: ${fmtV(v)} (${pctS(v / T)})` }, svg);
        const d = last ? barPath(x, cy - barH / 2, w, barH) : `M${x},${cy - barH / 2}h${w}v${barH}h${-w}Z`;
        s('path', { d, class: 'bar' }, g).style.fill = k.color;
        const lbl = pctS(v / T);
        if (measure(lbl, 11, 600) + 12 < w) text(g, lbl, { x: x + w / 2, y: cy, class: 'in ' + inkOn(k.color), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        bindTip(g, () => [r.label, keys.map(kk => {
          const vv = r.values[kk.key] || 0;
          return { color: kk.color, value: `${fmtV(vv)} (${pctS(vv / T)})`, label: kk.label };
        })]);
        x += full;
      });
      text(svg, totLbl(r), { x: W - 2, y: cy, class: 'val muted', 'text-anchor': 'end', 'dominant-baseline': 'central' });
    });
  }

  function ticks(lo, hi, n = 5) {
    if (lo === hi) hi = lo + 1;
    const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }

  /* pts: [{x,y,g,label,rows?}], o: {groups:[{key,label,color}], x:{label,fmt}, y:{label,fmt}, height, tip(p)} */
  function scatter(el, pts, o) {
    el.replaceChildren();
    if (!pts.length) return empty(el);
    if (o.groups && o.groups.length > 1) el.appendChild(legend(o.groups, 'dot'));
    const W = Math.max(el.clientWidth, 280), H = o.height || 320;
    const xt = ticks(Math.min(0, ...pts.map(p => p.x)), Math.max(...pts.map(p => p.x)));
    const yt = ticks(Math.min(0, ...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)));
    const fx = o.x.fmt || String, fy = o.y.fmt || String;
    const mL = Math.max(...yt.map(t => measure(fy(t), 11))) + 14, mR = 12, mT = 24, mB = 44;
    const pw = W - mL - mR, ph = H - mT - mB;
    const X = v => mL + ((v - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw;
    const Y = v => mT + ph - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ph;
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': o.label || '' }, el);
    s('rect', { x: 0, y: 0, width: W, height: H, class: 'hit' }, svg);
    yt.forEach((t, i) => {
      s('line', { x1: mL, x2: W - mR, y1: Y(t), y2: Y(t), class: i === 0 ? 'axis' : 'grid' }, svg);
      text(svg, fy(t), { x: mL - 8, y: Y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'central' });
    });
    xt.forEach(t => text(svg, fx(t), { x: X(t), y: mT + ph + 18, class: 'tick', 'text-anchor': 'middle' }));
    text(svg, o.y.label, { x: 0, y: 12, class: 'axis-title' });
    text(svg, o.x.label, { x: W - mR, y: H - 4, class: 'axis-title', 'text-anchor': 'end' });
    const colorOf = g => ((o.groups || []).find(x => x.key === g) || {}).color || 'var(--s1)';
    const dots = pts.map(p => {
      const c = s('circle', { cx: X(p.x), cy: Y(p.y), r: 4, class: 'dot' }, svg);
      c.style.fill = colorOf(p.g);
      return c;
    });
    // nearest-point hover layer: the pointer only has to be closest (within 24px)
    let cur = -1;
    const pick = e => {
      const b = svg.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
      let best = -1, bd = 24 * 24;
      pts.forEach((p, i) => { const dx = X(p.x) - mx, dy = Y(p.y) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } });
      return best;
    };
    svg.addEventListener('pointermove', e => {
      const i = pick(e);
      if (i !== cur) {
        if (cur >= 0) dots[cur].classList.remove('hover');
        cur = i;
        if (i >= 0) { dots[i].classList.add('hover'); svg.appendChild(dots[i]); }
      }
      if (i >= 0) {
        const p = pts[i];
        showTip(e, p.label, o.tip ? o.tip(p, colorOf(p.g)) : [{ value: `${fx(p.x)}, ${fy(p.y)}`, color: colorOf(p.g) }]);
      } else hideTip();
    });
    svg.addEventListener('pointerleave', () => { if (cur >= 0) dots[cur].classList.remove('hover'); cur = -1; hideTip(); });
  }

  window.Charts = { hbar, stack, scatter, legend, measure, hideTip };
})();
