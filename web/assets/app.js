/* Supply Chain DSS — filters, decision models and page rendering.
   Models: MCDM supplier ranking (SAW / TOPSIS + sensitivity), reorder-point inventory, logistics scoring. */
(function () {
  'use strict';
  const D = window.DATA || [], REPORT = window.REPORT || {}, COLS = window.COLUMNS || [];
  const $ = id => document.getElementById(id);

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  // ---------- formatting & stats ----------
  const nf = d => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const N0 = nf(0), N1 = nf(1), N2 = nf(2);
  const f0 = v => N0.format(v), f1 = v => N1.format(v), f2 = v => N2.format(v);
  const pct = v => (isFinite(v) ? N1.format(v) : '0') + '%';
  const compact = v => Math.abs(v) >= 1e6 ? N1.format(v / 1e6) + 'M' : Math.abs(v) >= 1e4 ? N1.format(v / 1e3) + 'K' : N0.format(v);
  const sum = (a, f = x => x) => { let s = 0; for (const x of a) s += f(x); return s; };
  const mean = (a, f) => (a.length ? sum(a, f) / a.length : 0);
  const groupBy = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
  const uniq = k => [...new Set(D.map(r => r[k]))].sort(natural);
  function corr(a, b) {
    const ma = mean(a), mb = mean(b);
    let s = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
    return sa && sb ? s / Math.sqrt(sa * sb) : 0;
  }

  // ---------- labels & colors ----------
  const TH = {
    product_type: { cosmetics: 'เครื่องสำอาง', haircare: 'ผลิตภัณฑ์ดูแลผม', skincare: 'ผลิตภัณฑ์ดูแลผิว' },
    inspection: { Pass: 'ผ่าน', Pending: 'รอตรวจ', Fail: 'ไม่ผ่าน' },
    transport: { Air: 'ทางอากาศ', Rail: 'ทางราง', Road: 'ทางถนน', Sea: 'ทางเรือ' },
    customer_demo: { Female: 'หญิง', Male: 'ชาย', 'Non-binary': 'นอนไบนารี', Unknown: 'ไม่ระบุ' },
  };
  const lab = (k, v) => (TH[k] && TH[k][v]) || v;
  // color follows the entity: slot fixed from the full dataset, never from the filtered rank
  const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
  const colorOf = {};
  for (const k of ['product_type', 'customer_demo']) colorOf[k] = Object.fromEntries(uniq(k).map((v, i) => [v, SLOTS[i]]));

  const INSP = [
    { key: 'Pass', label: 'ผ่าน', color: 'var(--good)', icon: '✓', cls: 'good' },
    { key: 'Pending', label: 'รอตรวจ', color: 'var(--warning)', icon: '…', cls: 'warning' },
    { key: 'Fail', label: 'ไม่ผ่าน', color: 'var(--critical)', icon: '✕', cls: 'critical' },
  ];
  const INV = [
    { key: 'out', label: 'หมดสต็อก', color: 'var(--critical)', icon: '✕', cls: 'critical', note: 'ต้องเติมสินค้าด่วน' },
    { key: 'reorder', label: 'ต้องสั่งทันที', color: 'var(--serious)', icon: '!', cls: 'serious', note: 'ต่ำกว่าจุดสั่งซื้อ (ROP)' },
    { key: 'watch', label: 'เฝ้าระวัง', color: 'var(--warning)', icon: '◔', cls: 'warning', note: 'ต่ำกว่า 1.5 × ROP' },
    { key: 'ok', label: 'ปกติ', color: 'var(--good)', icon: '✓', cls: 'good', note: 'สต็อกเพียงพอ' },
  ];
  const INV_BY = Object.fromEntries(INV.map((s, i) => [s.key, { ...s, rank: i }]));
  const chip = s => h('span', { class: 'st ' + s.cls }, h('span', { class: 'ic', style: `background:${s.color}` }, s.icon), s.label);
  const tag = (text, color) => h('span', { class: 'tag' }, h('i', { style: `background:${color}` }), text);

  const PAGES = {
    overview: { t: 'ภาพรวม', d: 'สรุปผลการดำเนินงานและข้อเสนอแนะสำหรับการตัดสินใจ' },
    products: { t: 'สินค้าและยอดขาย', d: 'วิเคราะห์รายได้ ราคา และกลุ่มลูกค้าของแต่ละประเภทสินค้า' },
    supplier: { t: 'ประเมินซัพพลายเออร์', d: 'จัดอันดับด้วยการตัดสินใจแบบหลายเกณฑ์ (MCDM) — ปรับน้ำหนักตามนโยบายของคุณ' },
    inventory: { t: 'สต็อกสินค้า', d: 'คำนวณจุดสั่งซื้อ (Reorder Point) และปริมาณที่ควรสั่งของแต่ละ SKU' },
    logistics: { t: 'การขนส่ง', d: 'เปรียบเทียบรูปแบบการขนส่ง ผู้ให้บริการ และเส้นทาง ตามต้นทุนและเวลา' },
    data: { t: 'ข้อมูลและการคลีน', d: 'ที่มาของข้อมูล ขั้นตอนการทำความสะอาด และตารางข้อมูลที่พร้อมใช้' },
  };

  // ---------- state (persisted per browser) ----------
  const DEF = {
    type: '', loc: '',
    sup: { method: 'saw', w: { defect: 5, pass: 4, cost: 4, lead: 3, mfg: 2, cap: 2 } },
    inv: { P: 180, SS: 7, cycle: 30, view: 'risk', q: '' },
    log: { dim: 'transport', w: { cost: 5, time: 4, total: 3 } },
    data: { q: '' },
  };
  const clone = o => JSON.parse(JSON.stringify(o));
  function merge(a, b) {
    for (const k in b) {
      if (!(k in a)) continue;
      if (a[k] && typeof a[k] === 'object') merge(a[k], b[k]);
      else if (typeof a[k] === typeof b[k]) a[k] = b[k];
    }
    return a;
  }
  let S = clone(DEF);
  try { const saved = JSON.parse(localStorage.getItem('scdss') || 'null'); if (saved) S = merge(clone(DEF), saved); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem('scdss', JSON.stringify(S)); } catch (e) { /* ignore */ } };
  const filtered = () => D.filter(r => (!S.type || r.product_type === S.type) && (!S.loc || r.location === S.loc));

  // ---------- decision models ----------
  const SUP_CRIT = [
    { key: 'defect', label: 'อัตราของเสีย', unit: '%', dir: 'min', f: g => mean(g, r => r.defect_rate), fmt: f2 },
    { key: 'pass', label: 'อัตราผ่านตรวจ', unit: '%', dir: 'max', f: g => (g.filter(r => r.inspection === 'Pass').length / g.length) * 100, fmt: f1 },
    { key: 'cost', label: 'ต้นทุนการผลิต', unit: '', dir: 'min', f: g => mean(g, r => r.mfg_cost), fmt: f2 },
    { key: 'lead', label: 'Lead time', unit: ' วัน', dir: 'min', f: g => mean(g, r => r.supplier_lead_days), fmt: f1 },
    { key: 'mfg', label: 'เวลาผลิต', unit: ' วัน', dir: 'min', f: g => mean(g, r => r.mfg_lead_days), fmt: f1 },
    { key: 'cap', label: 'ปริมาณการผลิต', unit: '', dir: 'max', f: g => mean(g, r => r.prod_volume), fmt: f0 },
  ];
  const LOG_CRIT = [
    { key: 'cost', label: 'ค่าขนส่ง', unit: '', dir: 'min', f: g => mean(g, r => r.ship_cost), fmt: f2 },
    { key: 'time', label: 'เวลาขนส่ง', unit: ' วัน', dir: 'min', f: g => mean(g, r => r.ship_days), fmt: f1 },
    { key: 'total', label: 'ต้นทุนรวม (Costs)', unit: '', dir: 'min', f: g => mean(g, r => r.total_cost), fmt: f0 },
  ];
  const LOG_DIMS = { transport: 'รูปแบบการขนส่ง', carrier: 'ผู้ให้บริการขนส่ง', route: 'เส้นทาง' };

  /* alts: [{name, raw:[...]}] -> sorted copy with score (0-100) and good[] (0-1 min-max goodness per criterion) */
  function mcdm(alts, crit, w, method) {
    const m = crit.length, tw = sum(crit, c => w[c.key] || 0);
    const cols = crit.map((c, j) => alts.map(a => a.raw[j]));
    const good = cols.map((col, j) => {
      const lo = Math.min(...col), hi = Math.max(...col);
      return col.map(v => (hi === lo ? 1 : crit[j].dir === 'max' ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)));
    });
    let scores;
    if (!tw) scores = alts.map(() => 0);
    else if (method === 'topsis') {
      const V = cols.map((col, j) => {
        const den = Math.sqrt(sum(col, v => v * v)) || 1, wn = (w[crit[j].key] || 0) / tw;
        return col.map(v => (v / den) * wn);
      });
      const best = V.map((col, j) => (crit[j].dir === 'max' ? Math.max(...col) : Math.min(...col)));
      const worst = V.map((col, j) => (crit[j].dir === 'max' ? Math.min(...col) : Math.max(...col)));
      scores = alts.map((a, i) => {
        let dp = 0, dm = 0;
        for (let j = 0; j < m; j++) { dp += (V[j][i] - best[j]) ** 2; dm += (V[j][i] - worst[j]) ** 2; }
        dp = Math.sqrt(dp); dm = Math.sqrt(dm);
        return dp + dm ? (dm / (dp + dm)) * 100 : 100;
      });
    } else {
      scores = alts.map((a, i) => {
        let s = 0;
        for (let j = 0; j < m; j++) s += (w[crit[j].key] || 0) * good[j][i];
        return (s / tw) * 100;
      });
    }
    return alts.map((a, i) => ({ ...a, score: scores[i], good: good.map(g => g[i]) }))
      .sort((a, b) => b.score - a.score || natural(a.name, b.name));
  }

  // re-run with each weight scaled 0x / 0.5x / 1.5x / 2x and count how often the winner holds
  function sensitivity(alts, crit, w, method, winner) {
    let same = 0, total = 0;
    for (const c of crit) {
      if (!w[c.key]) continue;
      for (const f of [0, 0.5, 1.5, 2]) {
        const w2 = { ...w, [c.key]: w[c.key] * f };
        if (!sum(crit, x => w2[x.key] || 0)) continue;
        total++;
        if (mcdm(alts, crit, w2, method)[0].name === winner) same++;
      }
    }
    return { same, total };
  }

  function supplierModel(rs) {
    const alts = [...groupBy(rs, 'supplier')].map(([name, list]) => ({
      name, n: list.length, revenue: sum(list, r => r.revenue), raw: SUP_CRIT.map(c => c.f(list)),
    }));
    if (!alts.length) return { ranked: [], stab: null };
    const ranked = mcdm(alts, SUP_CRIT, S.sup.w, S.sup.method);
    return { ranked, stab: sensitivity(alts, SUP_CRIT, S.sup.w, S.sup.method, ranked[0].name) };
  }

  function inventoryModel(rs) {
    const { P, SS, cycle } = S.inv;
    return rs.map(r => {
      const d = r.units_sold / P, L = r.supplier_lead_days, rop = d * (L + SS);
      const cover = d > 0 ? r.stock / d : Infinity;
      const st = r.stock === 0 ? 'out' : r.stock <= rop ? 'reorder' : r.stock <= rop * 1.5 ? 'watch' : 'ok';
      const q = st === 'out' || st === 'reorder' ? Math.max(0, Math.ceil(d * (L + SS + cycle) - r.stock)) : 0;
      return { ...r, d, rop, cover, st, q, gap: Math.max(0, L - cover) };
    }).sort((a, b) => INV_BY[a.st].rank - INV_BY[b.st].rank || (a.cover - a.supplier_lead_days) - (b.cover - b.supplier_lead_days));
  }

  function logisticsModel(rs, dim) {
    const alts = [...groupBy(rs, dim)].map(([name, list]) => ({ name, n: list.length, raw: LOG_CRIT.map(c => c.f(list)) }));
    return alts.length ? mcdm(alts, LOG_CRIT, S.log.w, 'saw') : [];
  }

  // ---------- UI helpers ----------
  function table(box, cols, rows, opt = {}) {
    const st = box._sort || (box._sort = { k: null, dir: 1 });
    let data = rows.slice();
    const sc = st.k != null && cols.find(c => c.key === st.k);
    if (sc) {
      const val = sc.sortVal || (r => r[sc.key]);
      data.sort((a, b) => {
        const x = val(a), y = val(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th', { numeric: true })) * st.dir;
      });
    }
    const thead = h('thead', {}, h('tr', {}, cols.map(c => {
      const th = h('th', { scope: 'col', class: c.num ? 'num' : null });
      if (c.sort === false) { th.textContent = c.label; return th; }
      if (st.k === c.key) th.setAttribute('aria-sort', st.dir > 0 ? 'ascending' : 'descending');
      th.append(h('button', {
        type: 'button', class: 'th-sort',
        onclick: () => { st.dir = st.k === c.key ? -st.dir : c.num ? -1 : 1; st.k = c.key; table(box, cols, rows, opt); },
      }, c.label, h('span', { class: 'sort-ind', 'aria-hidden': 'true' }, st.k === c.key ? (st.dir > 0 ? '▲' : '▼') : '')));
      return th;
    })));
    const tbody = h('tbody');
    if (!data.length) tbody.append(h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, opt.empty || 'ไม่มีข้อมูลตามตัวกรองนี้')));
    for (const r of data) {
      tbody.append(h('tr', { class: opt.rowClass ? opt.rowClass(r) : null }, cols.map(c => {
        const v = c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key];
        return h('td', { class: c.num ? 'num' : null }, v instanceof Node ? v : String(v ?? ''));
      })));
    }
    box.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, thead, tbody)));
  }

  function heatTable(box, o) {
    const thead = h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, o.corner), o.cols.map(c => h('th', { scope: 'col', class: 'num' }, c))));
    const tbody = h('tbody', {}, o.rows.map(r => h('tr', { class: o.rowClass ? o.rowClass(r) : null },
      h('th', { scope: 'row', style: 'background:var(--surface);color:var(--ink);font-weight:500;text-align:left' }, r.label),
      o.cols.map((c, j) => {
        const v = o.cell(r, j);
        const td = h('td', { class: 'heat' }, v.text, v.small != null ? h('small', {}, v.small) : null);
        if (v.t != null) td.style.background = `color-mix(in srgb, var(--s1) ${Math.round(6 + v.t * 54)}%, var(--surface))`;
        return td;
      }))));
    box.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, thead, tbody)),
      h('div', { class: 'heat-legend' }, h('span', {}, o.legend[0]), h('i'), h('span', {}, o.legend[1])));
  }

  function tiles(box, items) {
    box.replaceChildren(...items.map(t => h('div', { class: 'card tile' },
      h('span', { class: 'lbl' }, t.status ? h('span', { class: 'ic-dot', style: `background:${t.status.color};${t.status.cls === 'warning' || t.status.cls === 'serious' ? 'color:#0b0b0b' : ''}` }, t.status.icon) : null, t.label),
      h('span', { class: 'val' }, t.value),
      t.note ? h('span', { class: 'note' }, t.note) : null)));
  }

  function slider(o) {
    const out = h('output');
    const inp = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, 'aria-label': o.label });
    inp.value = o.value;
    inp.addEventListener('input', () => o.onInput(+inp.value));
    const el = h('label', { class: 'sl' }, h('span', { class: 'sl-l' }, o.label, o.hint ? h('small', {}, o.hint) : null), out, inp);
    return { el, inp, out };
  }
  function syncWeights(ui, w, crit) {
    const tw = sum(crit, c => w[c.key] || 0);
    for (const c of crit) {
      ui[c.key].inp.value = w[c.key];
      ui[c.key].out.replaceChildren(String(w[c.key]), h('small', {}, ` · ${tw ? Math.round((w[c.key] / tw) * 100) : 0}%`));
    }
  }
  function segmented(box, options, get, set) {
    const btns = options.map(([v, label]) => h('button', { type: 'button', role: 'radio', 'data-v': v }, label));
    const sync = () => btns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === get())));
    btns.forEach(b => b.addEventListener('click', () => { set(b.dataset.v); sync(); }));
    box.replaceChildren(...btns);
    sync();
  }

  function initCards() {
    document.querySelectorAll('.card.chart').forEach(card => {
      const btn = h('button', { type: 'button', class: 'btn ghost sm tbl-toggle', 'aria-pressed': 'false' }, 'ตาราง');
      btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        btn.textContent = on ? 'กราฟ' : 'ตาราง';
        card.querySelector('.viz').hidden = on;
        card.querySelector('.viz-table').hidden = !on;
        renderPage();
      });
      card.append(
        h('div', { class: 'card-h' }, h('div', {}, h('h3', {}, card.dataset.title), h('p', { class: 'sub' }, card.dataset.sub || '')), btn),
        h('div', { class: 'viz' }), h('div', { class: 'viz-table', hidden: true }));
    });
  }
  // every chart has a table twin (shown via the toggle)
  function chart(id, draw, cols, rows, head) {
    const card = $(id), viz = card.querySelector('.viz');
    if (head && head.title) card.querySelector('h3').textContent = head.title;
    if (head && head.sub != null) card.querySelector('.card-h .sub').textContent = head.sub;
    if (!viz.hidden) draw(viz);
    table(card.querySelector('.viz-table'), cols, rows);
  }

  function downloadCSV(name, cols, rows) {
    const esc = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(c.csv ? c.csv(r) : r[c.key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const update = () => { save(); renderPage(); };

  // ---------- pages ----------
  function strengths(alt, crit, w) {
    return crit.map((c, j) => ({ c, j, g: alt.good[j] })).filter(x => (w[x.c.key] || 0) > 0);
  }

  function renderOverview(rs) {
    const rev = sum(rs, r => r.revenue), units = sum(rs, r => r.units_sold);
    $('ovRev').textContent = f0(rev);
    $('ovRevSub').textContent = `จาก ${rs.length} SKU · ขายได้ ${f0(units)} หน่วย · เฉลี่ย ${f0(rs.length ? rev / rs.length : 0)} ต่อ SKU`;
    const inv = inventoryModel(rs), need = inv.filter(r => r.st === 'out' || r.st === 'reorder');
    const pass = rs.filter(r => r.inspection === 'Pass').length;
    tiles($('ovTiles'), [
      { label: 'ต้นทุนรวม', value: compact(sum(rs, r => r.total_cost)), note: 'ผลรวมคอลัมน์ Costs' },
      { label: 'อัตราของเสียเฉลี่ย', value: f2(mean(rs, r => r.defect_rate)) + '%', note: 'ยิ่งต่ำยิ่งดี' },
      { label: 'ผ่านการตรวจคุณภาพ', value: pct(rs.length ? (pass / rs.length) * 100 : 0), note: `${pass} จาก ${rs.length} SKU` },
      { label: 'SKU ที่ต้องสั่งซื้อ', value: f0(need.length), status: need.length ? INV_BY.reorder : INV_BY.ok,
        note: `หมดสต็อก ${inv.filter(r => r.st === 'out').length} · ต่ำกว่า ROP ${inv.filter(r => r.st === 'reorder').length}` },
    ]);

    const sup = supplierModel(rs).ranked, logT = logisticsModel(rs, 'transport');
    const byType = [...groupBy(rs, 'product_type')].map(([k, l]) => ({ k, rev: sum(l, r => r.revenue) })).sort((a, b) => b.rev - a.rev);
    const worst = [...sup].sort((a, b) => b.raw[0] - a.raw[0])[0];
    const cards = [];
    if (sup.length) {
      const top = strengths(sup[0], SUP_CRIT, S.sup.w).sort((a, b) => b.g * S.sup.w[b.c.key] - a.g * S.sup.w[a.c.key])[0];
      cards.push({ k: 'ซัพพลายเออร์ที่แนะนำ', color: 'var(--accent)', title: sup[0].name, page: 'supplier',
        body: `คะแนน ${f1(sup[0].score)}/100 (${S.sup.method.toUpperCase()})` + (top ? ` · เด่นด้าน${top.c.label}` : '') });
    }
    cards.push({ k: 'สต็อกสินค้า', color: need.length ? 'var(--serious)' : 'var(--good)', page: 'inventory',
      title: need.length ? `${need.length} SKU ต้องสั่งซื้อ` : 'สต็อกเพียงพอ',
      body: need.length ? `แนะนำสั่งรวม ${f0(sum(need, r => r.q))} หน่วย · เร่งด่วนที่สุด ${need[0].sku}` : 'ไม่มี SKU ที่ต่ำกว่าจุดสั่งซื้อ' });
    if (logT.length) cards.push({ k: 'รูปแบบขนส่งที่คุ้มค่าที่สุด', color: 'var(--accent)', page: 'logistics',
      title: lab('transport', logT[0].name), body: `ค่าขนส่งเฉลี่ย ${f2(logT[0].raw[0])} · ${f1(logT[0].raw[1])} วัน` });
    if (worst) cards.push({ k: 'ความเสี่ยงด้านคุณภาพ', color: 'var(--critical)', page: 'supplier',
      title: `${worst.name} ของเสียสูงสุด`, body: `อัตราของเสียเฉลี่ย ${f2(worst.raw[0])}% · ตรวจไม่ผ่าน ${rs.filter(r => r.inspection === 'Fail').length} SKU` });
    if (byType.length) cards.push({ k: 'ประเภทสินค้าที่ทำรายได้สูงสุด', color: colorOf.product_type[byType[0].k], page: 'products',
      title: lab('product_type', byType[0].k), body: `${pct((byType[0].rev / rev) * 100)} ของรายได้ทั้งหมด` });
    $('ovInsights').replaceChildren(...cards.map(c => h('button', { type: 'button', class: 'insight', onclick: () => { location.hash = c.page; } },
      h('span', { class: 'k' }, h('i', { style: `background:${c.color}` }), c.k), h('b', {}, c.title), h('p', {}, c.body), h('span', { class: 'go' }, 'ดูรายละเอียด →'))));

    const typeRows = byType.map(t => ({ label: lab('product_type', t.k), value: t.rev, share: (t.rev / rev) * 100, color: colorOf.product_type[t.k],
      extra: [{ value: pct((t.rev / rev) * 100), label: 'ของรายได้รวม' }] }));
    chart('c-ov-revtype', el => Charts.hbar(el, typeRows, { fmt: f0, valueLabel: 'รายได้' }),
      [{ key: 'label', label: 'ประเภทสินค้า' }, { key: 'value', label: 'รายได้', num: true, fmt: f0 }, { key: 'share', label: 'สัดส่วน', num: true, fmt: pct }], typeRows);

    const types = uniq('product_type').filter(t => rs.some(r => r.product_type === t));
    const inspRows = types.map(t => {
      const l = rs.filter(r => r.product_type === t);
      return { label: lab('product_type', t), values: Object.fromEntries(INSP.map(k => [k.key, l.filter(r => r.inspection === k.key).length])) };
    });
    chart('c-ov-insp', el => Charts.stack(el, inspRows, INSP, { unit: 'SKU' }),
      [{ key: 'label', label: 'ประเภทสินค้า' }, ...INSP.map(k => ({ key: k.key, label: k.label, num: true, render: r => r.values[k.key], sortVal: r => r.values[k.key] }))], inspRows);

    const locRows = [...groupBy(rs, 'location')].map(([k, l]) => ({ label: k, value: sum(l, r => r.revenue), n: l.length,
      extra: [{ value: f0(l.length), label: 'SKU' }] })).sort((a, b) => b.value - a.value);
    chart('c-ov-revloc', el => Charts.hbar(el, locRows, { fmt: f0, valueLabel: 'รายได้' }),
      [{ key: 'label', label: 'สถานที่' }, { key: 'value', label: 'รายได้', num: true, fmt: f0 }, { key: 'n', label: 'SKU', num: true }], locRows);

    const defRows = [...groupBy(rs, 'supplier')].map(([k, l]) => ({ label: k, value: mean(l, r => r.defect_rate), n: l.length,
      extra: [{ value: f0(l.length), label: 'SKU' }] })).sort((a, b) => a.value - b.value);
    chart('c-ov-defect', el => Charts.hbar(el, defRows, { fmt: v => f2(v) + '%', valueLabel: 'อัตราของเสียเฉลี่ย' }),
      [{ key: 'label', label: 'ซัพพลายเออร์' }, { key: 'value', label: 'อัตราของเสีย (%)', num: true, fmt: f2 }, { key: 'n', label: 'SKU', num: true }], defRows);
  }

  function renderProducts(rs) {
    const rev = sum(rs, r => r.revenue);
    tiles($('prTiles'), [
      { label: 'จำนวน SKU', value: f0(rs.length), note: `${new Set(rs.map(r => r.product_type)).size} ประเภทสินค้า` },
      { label: 'จำนวนที่ขายได้', value: f0(sum(rs, r => r.units_sold)), note: 'หน่วย' },
      { label: 'ราคาเฉลี่ย', value: f2(mean(rs, r => r.price)), note: 'ต่อหน่วย' },
      { label: 'ความพร้อมจำหน่ายเฉลี่ย', value: f1(mean(rs, r => r.availability)) + '%', note: 'Availability' },
    ]);

    const groups = uniq('product_type').filter(t => rs.some(r => r.product_type === t))
      .map(t => ({ key: t, label: lab('product_type', t), color: colorOf.product_type[t] }));
    const r = corr(rs.map(x => x.price), rs.map(x => x.units_sold));
    const strength = Math.abs(r) < 0.2 ? 'แทบไม่มีความสัมพันธ์' : Math.abs(r) < 0.5 ? 'สัมพันธ์กันระดับอ่อน' : 'สัมพันธ์กันระดับสูง';
    const pts = rs.map(x => ({ x: x.price, y: x.units_sold, g: x.product_type, label: `${x.sku} · ${lab('product_type', x.product_type)}`, row: x }));
    chart('c-pr-scatter', el => Charts.scatter(el, pts, {
      groups, height: 340, x: { label: 'ราคาต่อหน่วย →', fmt: f0 }, y: { label: '↑ จำนวนที่ขายได้', fmt: compact },
      tip: (p, color) => [{ value: f2(p.row.price), label: 'ราคา', color }, { value: f0(p.row.units_sold), label: 'หน่วยที่ขาย' }, { value: f0(p.row.revenue), label: 'รายได้' }],
    }), [{ key: 'sku', label: 'SKU' }, { key: 'product_type', label: 'ประเภท', fmt: v => lab('product_type', v) }, { key: 'price', label: 'ราคา', num: true, fmt: f2 },
      { key: 'units_sold', label: 'จำนวนที่ขาย', num: true, fmt: f0 }, { key: 'revenue', label: 'รายได้', num: true, fmt: f0 }], rs,
    { sub: `สหสัมพันธ์ r = ${f2(r)} — ${strength}${Math.abs(r) >= 0.2 ? (r > 0 ? ' (ราคาสูง ขายได้มากขึ้น)' : ' (ราคาสูง ขายได้น้อยลง)') : ' การตั้งราคาจึงไม่ใช่ตัวขับยอดขายหลัก'}` });

    const top = [...rs].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const topRows = top.map(x => ({ label: x.sku, value: x.revenue, type: x.product_type, color: colorOf.product_type[x.product_type],
      extra: [{ value: lab('product_type', x.product_type), label: '' }, { value: f0(x.units_sold), label: 'หน่วยที่ขาย' }] }));
    const topTypes = groups.filter(g => top.some(x => x.product_type === g.key));
    chart('c-pr-top', el => Charts.hbar(el, topRows, { fmt: f0, valueLabel: 'รายได้', legend: topTypes.length > 1 ? topTypes : null, rowH: 28, barH: 14 }),
      [{ key: 'label', label: 'SKU' }, { key: 'type', label: 'ประเภท', fmt: v => lab('product_type', v) }, { key: 'value', label: 'รายได้', num: true, fmt: f0 }], topRows);

    const demos = uniq('customer_demo').map(d => ({ key: d, label: lab('customer_demo', d), color: colorOf.customer_demo[d] }));
    const demoRows = groups.map(g => {
      const l = rs.filter(x => x.product_type === g.key);
      return { label: g.label, values: Object.fromEntries(demos.map(d => [d.key, sum(l.filter(x => x.customer_demo === d.key), x => x.units_sold)])) };
    });
    chart('c-pr-demo', el => Charts.stack(el, demoRows, demos, { fmt: f0, unit: 'หน่วย' }),
      [{ key: 'label', label: 'ประเภทสินค้า' }, ...demos.map(d => ({ key: d.key, label: d.label, num: true, render: r => f0(r.values[d.key]), sortVal: r => r.values[d.key] }))], demoRows);

    const sumRows = groups.map(g => {
      const l = rs.filter(x => x.product_type === g.key), rv = sum(l, x => x.revenue);
      return { type: g.label, n: l.length, rev: rv, share: (rv / rev) * 100, units: sum(l, x => x.units_sold), price: mean(l, x => x.price),
        defect: mean(l, x => x.defect_rate), stock: sum(l, x => x.stock), avail: mean(l, x => x.availability) };
    }).sort((a, b) => b.rev - a.rev);
    table($('prTable'), [
      { key: 'type', label: 'ประเภทสินค้า' }, { key: 'n', label: 'SKU', num: true }, { key: 'rev', label: 'รายได้', num: true, fmt: f0 },
      { key: 'share', label: 'สัดส่วนรายได้', num: true, fmt: pct }, { key: 'units', label: 'หน่วยที่ขาย', num: true, fmt: f0 },
      { key: 'price', label: 'ราคาเฉลี่ย', num: true, fmt: f2 }, { key: 'avail', label: 'Availability เฉลี่ย (%)', num: true, fmt: f1 },
      { key: 'defect', label: 'ของเสียเฉลี่ย (%)', num: true, fmt: f2 }, { key: 'stock', label: 'สต็อกรวม', num: true, fmt: f0 },
    ], sumRows);
  }

  const supUI = {}, logUI = {}, invUI = {};
  function renderSupplier(rs) {
    syncWeights(supUI, S.sup.w, SUP_CRIT);
    const { ranked, stab } = supplierModel(rs);
    const tw = sum(SUP_CRIT, c => S.sup.w[c.key]);
    const reco = $('supReco');
    if (!ranked.length || !tw) {
      reco.replaceChildren(h('span', { class: 'eyebrow' }, 'ซัพพลายเออร์ที่แนะนำ'), h('div', { class: 'name' }, '—'),
        h('p', { class: 'sub' }, ranked.length ? 'ตั้งน้ำหนักอย่างน้อย 1 เกณฑ์เพื่อเริ่มประเมิน' : 'ไม่มีข้อมูลตามตัวกรองนี้'));
    } else {
      const win = ranked[0], second = ranked[1], ss = strengths(win, SUP_CRIT, S.sup.w);
      const good = ss.filter(x => x.g >= 0.75).sort((a, b) => S.sup.w[b.c.key] - S.sup.w[a.c.key]);
      const weak = ss.filter(x => x.g <= 0.25).sort((a, b) => S.sup.w[b.c.key] - S.sup.w[a.c.key]);
      const desc = x => `${x.c.label} ${x.c.fmt(win.raw[x.j])}${x.c.unit}`;
      const ratio = stab && stab.total ? stab.same / stab.total : 1;
      reco.replaceChildren(
        h('span', { class: 'eyebrow' }, `ซัพพลายเออร์ที่แนะนำ · ${S.sup.method.toUpperCase()}`),
        h('div', { class: 'name' }, win.name),
        h('div', { class: 'score' }, h('b', {}, f1(win.score)), ' / 100 คะแนน',
          second ? ` · นำอันดับ 2 (${second.name}) ${f1(win.score - second.score)} คะแนน` : ''),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, win.score))}%` })),
        good.length ? h('div', { class: 'tags' }, h('span', { class: 'fld-lbl' }, 'จุดแข็ง'), good.map(x => tag(desc(x), 'var(--good)'))) : null,
        weak.length ? h('div', { class: 'tags' }, h('span', { class: 'fld-lbl' }, 'ควรระวัง'), weak.map(x => tag(desc(x), 'var(--serious)'))) : null,
        stab && stab.total ? h('p', { class: 'sub' }, `ความเสถียร: ${win.name} ยังชนะใน ${stab.same}/${stab.total} สถานการณ์ทดสอบ — `,
          h('b', {}, ratio >= 0.9 ? 'เสถียรมาก' : ratio >= 0.7 ? 'ค่อนข้างเสถียร' : 'อ่อนไหวต่อการเปลี่ยนน้ำหนัก ควรพิจารณาร่วมกับปัจจัยอื่น')) : null);
    }

    const items = ranked.map((a, i) => ({ label: a.name, value: a.score, color: 'var(--accent)', dim: i > 0, strong: i === 0,
      extra: [{ value: f0(a.n), label: 'SKU' }, { value: f0(a.revenue), label: 'รายได้' }] }));
    chart('c-sup-score', el => Charts.hbar(el, items, { fmt: f1, valueLabel: 'คะแนน', max: 100 }),
      [{ key: 'rank', label: 'อันดับ', num: true, render: r => items.indexOf(r) + 1, sortVal: r => items.indexOf(r) }, { key: 'label', label: 'ซัพพลายเออร์' },
        { key: 'value', label: 'คะแนน', num: true, fmt: f1 }], items, { sub: `คะแนนเต็ม 100 · วิธี ${S.sup.method.toUpperCase()}` });

    heatTable($('supHeat'), {
      corner: 'ซัพพลายเออร์',
      cols: [...SUP_CRIT.map(c => `${c.label} (${c.dir === 'min' ? 'ต่ำ = ดี' : 'สูง = ดี'})`), 'SKU', 'คะแนน'],
      rows: ranked.map(a => ({ ...a, label: a.name })),
      rowClass: r => (r === ranked[0] || r.name === (ranked[0] && ranked[0].name) ? 'win' : null),
      cell: (a, j) => j < SUP_CRIT.length ? { text: SUP_CRIT[j].fmt(a.raw[j]) + SUP_CRIT[j].unit, t: a.good[j] }
        : j === SUP_CRIT.length ? { text: f0(a.n) } : { text: f1(a.score) },
      legend: ['แย่กว่า', 'ดีกว่า'],
    });
  }

  function renderInventory(rs) {
    invUI.P.out.textContent = `${S.inv.P} วัน`;
    invUI.SS.out.textContent = `${S.inv.SS} วัน`;
    invUI.cycle.out.textContent = `${S.inv.cycle} วัน`;
    const inv = inventoryModel(rs);
    const count = k => inv.filter(r => r.st === k).length;
    const need = inv.filter(r => r.q > 0);
    tiles($('invTiles'), [
      ...INV.map(s => ({ label: s.label, value: f0(count(s.key)), note: s.note, status: s })),
      { label: 'แนะนำให้สั่งรวม', value: f0(sum(need, r => r.q)), note: `หน่วย จาก ${need.length} SKU` },
    ]);

    const types = uniq('product_type').filter(t => rs.some(r => r.product_type === t));
    const stRows = types.map(t => {
      const l = inv.filter(r => r.product_type === t);
      return { label: lab('product_type', t), values: Object.fromEntries(INV.map(s => [s.key, l.filter(r => r.st === s.key).length])) };
    });
    chart('c-inv-status', el => Charts.stack(el, stRows, INV, { unit: 'SKU' }),
      [{ key: 'label', label: 'ประเภทสินค้า' }, ...INV.map(s => ({ key: s.key, label: s.label, num: true, render: r => r.values[s.key], sortVal: r => r.values[s.key] }))], stRows);

    const q = S.inv.q.trim().toLowerCase();
    const list = inv.filter(r => (S.inv.view === 'all' || r.st !== 'ok') &&
      (!q || [r.sku, r.supplier, r.location, lab('product_type', r.product_type)].some(v => String(v).toLowerCase().includes(q))));
    $('invListSub').textContent = `${list.length} รายการ · แนะนำสั่งรวม ${f0(sum(list, r => r.q))} หน่วย · เรียงตามความเร่งด่วน (สต็อกหมดก่อนของเข้า)`;
    $('invExport').disabled = !list.some(r => r.q > 0);
    const inspOf = Object.fromEntries(INSP.map(s => [s.key, s]));
    table($('invTable'), [
      { key: 'sku', label: 'SKU' },
      { key: 'st', label: 'สถานะ', render: r => chip(INV_BY[r.st]), sortVal: r => INV_BY[r.st].rank },
      { key: 'q', label: 'แนะนำสั่ง', num: true, render: r => (r.q ? h('b', {}, f0(r.q)) : '—'), sortVal: r => r.q },
      { key: 'stock', label: 'สต็อก', num: true },
      { key: 'rop', label: 'ROP', num: true, fmt: v => f0(Math.ceil(v)) },
      { key: 'd', label: 'ต้องการ/วัน', num: true, fmt: f2 },
      { key: 'supplier_lead_days', label: 'Lead time', num: true, fmt: v => `${v} วัน` },
      { key: 'cover', label: 'พอใช้', num: true, fmt: v => (isFinite(v) ? f1(v) + ' วัน' : '∞') },
      { key: 'gap', label: 'ขาดก่อนของเข้า', num: true, fmt: v => (v > 0 ? f1(v) + ' วัน' : '—') },
      { key: 'supplier', label: 'ซัพพลายเออร์' },
      { key: 'product_type', label: 'ประเภท', fmt: v => lab('product_type', v) },
      { key: 'inspection', label: 'ผลตรวจ', render: r => chip(inspOf[r.inspection] || { cls: '', color: 'var(--muted)', icon: '?', label: r.inspection }) },
    ], list, { empty: 'ไม่มี SKU ที่ต้องดำเนินการ' });
    $('invExport').onclick = () => downloadCSV(`purchase_orders_${new Date().toISOString().slice(0, 10)}.csv`, [
      { key: 'sku', label: 'SKU' }, { key: 'product_type', label: 'product_type' }, { key: 'supplier', label: 'supplier' },
      { key: 'location', label: 'location' }, { key: 'stock', label: 'stock' }, { key: 'd', label: 'daily_demand', csv: r => r.d.toFixed(2) },
      { key: 'supplier_lead_days', label: 'lead_time_days' }, { key: 'rop', label: 'reorder_point', csv: r => Math.ceil(r.rop) },
      { key: 'q', label: 'suggested_order_qty' }, { key: 'st', label: 'status', csv: r => INV_BY[r.st].label },
    ], list.filter(r => r.q > 0));
  }

  function renderLogistics(rs) {
    syncWeights(logUI, S.log.w, LOG_CRIT);
    const dim = S.log.dim, res = {};
    for (const d of Object.keys(LOG_DIMS)) res[d] = logisticsModel(rs, d);
    $('logReco').replaceChildren(...Object.keys(LOG_DIMS).map(d => {
      const top = res[d][0];
      return h('div', { class: 'card' }, h('span', { class: 'eyebrow' }, `${LOG_DIMS[d]}ที่แนะนำ`),
        h('div', { class: 'name' }, top ? lab(d, top.name) : '—'),
        top ? h('p', {}, `ค่าขนส่ง ${f2(top.raw[0])} · ${f1(top.raw[1])} วัน · คะแนน ${f1(top.score)}`) : null);
    }));
    const cur = res[dim];
    const extra = a => [{ value: f0(a.n), label: 'SKU' }];
    const items = cur.map((a, i) => ({ label: lab(dim, a.name), value: a.score, color: 'var(--accent)', dim: i > 0, strong: i === 0, n: a.n, extra: extra(a) }));
    chart('c-log-score', el => Charts.hbar(el, items, { fmt: f1, valueLabel: 'คะแนน', max: 100 }),
      [{ key: 'label', label: LOG_DIMS[dim] }, { key: 'value', label: 'คะแนน', num: true, fmt: f1 }, { key: 'n', label: 'SKU', num: true }], items,
      { title: `คะแนนความคุ้มค่า — ${LOG_DIMS[dim]}`, sub: 'คะแนนเต็ม 100 (SAW) ตามน้ำหนักที่ตั้งไว้' });
    const metric = j => cur.map(a => ({ label: lab(dim, a.name), value: a.raw[j], n: a.n, extra: extra(a) })).sort((a, b) => a.value - b.value);
    const cost = metric(0), time = metric(1);
    chart('c-log-cost', el => Charts.hbar(el, cost, { fmt: f2, valueLabel: 'ค่าขนส่งเฉลี่ย' }),
      [{ key: 'label', label: LOG_DIMS[dim] }, { key: 'value', label: 'ค่าขนส่งเฉลี่ย', num: true, fmt: f2 }, { key: 'n', label: 'SKU', num: true }], cost,
      { title: `ค่าขนส่งเฉลี่ยตาม${LOG_DIMS[dim]}`, sub: 'ยิ่งต่ำยิ่งดี' });
    chart('c-log-time', el => Charts.hbar(el, time, { fmt: f1, valueLabel: 'วัน' }),
      [{ key: 'label', label: LOG_DIMS[dim] }, { key: 'value', label: 'เวลาขนส่งเฉลี่ย (วัน)', num: true, fmt: f1 }, { key: 'n', label: 'SKU', num: true }], time,
      { title: `เวลาขนส่งเฉลี่ยตาม${LOG_DIMS[dim]} (วัน)`, sub: 'ยิ่งต่ำยิ่งดี' });

    const carriers = uniq('carrier').filter(c => rs.some(r => r.carrier === c));
    const modes = uniq('transport').filter(m => rs.some(r => r.transport === m));
    const cells = carriers.map(c => modes.map(m => { const l = rs.filter(r => r.carrier === c && r.transport === m); return { n: l.length, v: l.length ? mean(l, r => r.ship_cost) : null }; }));
    const vals = cells.flat().filter(x => x.v != null).map(x => x.v), lo = Math.min(...vals), hi = Math.max(...vals);
    heatTable($('logHeat'), {
      corner: 'ผู้ให้บริการ', cols: modes.map(m => lab('transport', m)), rows: carriers.map((c, i) => ({ label: c, i })),
      cell: (r, j) => { const x = cells[r.i][j]; return x.v == null ? { text: '—' } : { text: f2(x.v), small: x.n, t: hi > lo ? (x.v - lo) / (hi - lo) : 0.5 }; },
      legend: ['ค่าขนส่งต่ำ', 'ค่าขนส่งสูง'],
    });
  }

  function renderData(rs) {
    const missing = (REPORT.steps || []).find(s => s.name.startsWith('จัดการค่าว่าง'));
    const dup = (REPORT.steps || []).find(s => s.name.startsWith('ลบแถวซ้ำ'));
    const rng = (REPORT.steps || []).find(s => s.name.startsWith('ตรวจช่วงค่า'));
    tiles($('dtTiles'), [
      { label: 'จำนวนแถว', value: `${REPORT.rows_in} → ${REPORT.rows_out}`, note: 'ก่อน → หลังคลีน' },
      { label: 'จำนวนคอลัมน์', value: `${REPORT.cols_in} → ${REPORT.cols_out}`, note: 'เพิ่ม total_lead_days' },
      { label: 'ค่าว่างที่จัดการ', value: f0(missing ? missing.affected : 0), note: 'เซลล์' },
      { label: 'แถวซ้ำที่ลบ', value: f0(dup ? dup.affected : 0), note: 'แถว' },
      { label: 'ค่าผิดช่วงที่ลบ', value: f0(rng ? rng.affected : 0), note: 'แถว' },
    ]);
    $('dtSrc').textContent = `ไฟล์ต้นฉบับ: ${REPORT.source || '-'}`;
    $('dtSteps').replaceChildren(...(REPORT.steps || []).map(s => h('li', {}, h('span', {}, s.name), h('span', { class: 'n' }, `${f0(s.affected)} รายการ`))));
    $('dtObs').replaceChildren(...(REPORT.observations || []).map(o => h('li', {}, o)));

    const KIND = { int: 'จำนวนเต็ม', float: 'ทศนิยม', cat: 'หมวดหมู่', id: 'รหัส' };
    const num = (m, k) => (m.after && m.after[k] != null ? m.after[k] : null);
    table($('dtCols'), [
      { key: 'raw', label: 'ชื่อเดิม' },
      { key: 'key', label: 'ชื่อใหม่', render: m => h('code', {}, m.key) },
      { key: 'label', label: 'ความหมาย' },
      { key: 'kind', label: 'ชนิด', fmt: v => KIND[v] || v },
      { key: 'miss', label: 'ค่าว่าง ก่อน → หลัง', num: true, render: m => `${m.before ? m.before.missing : '-'} → ${m.after.missing}`, sortVal: m => (m.before ? m.before.missing : 0) },
      { key: 'unique', label: 'ค่าไม่ซ้ำ', num: true, render: m => f0(m.after.unique), sortVal: m => m.after.unique },
      { key: 'min', label: 'ต่ำสุด', num: true, render: m => (num(m, 'min') != null ? f2(m.after.min) : ''), sortVal: m => num(m, 'min') ?? -Infinity },
      { key: 'max', label: 'สูงสุด', num: true, render: m => (num(m, 'max') != null ? f2(m.after.max) : ''), sortVal: m => num(m, 'max') ?? -Infinity },
      { key: 'mean', label: 'เฉลี่ย', num: true, render: m => (num(m, 'mean') != null ? f2(m.after.mean) : ''), sortVal: m => num(m, 'mean') ?? -Infinity },
      { key: 'out', label: 'ค่าผิดปกติ (IQR)', num: true, render: m => (num(m, 'outliers') != null ? f0(m.after.outliers) : ''), sortVal: m => num(m, 'outliers') ?? -1 },
      { key: 'values', label: 'ค่าที่พบ (หมวดหมู่)', sort: false,
        render: m => (m.after.values && m.kind === 'cat' ? Object.entries(m.after.values).map(([k, n]) => `${k} (${n})`).join(', ') : '') },
    ], COLS);

    const q = S.data.q.trim().toLowerCase();
    const list = q ? rs.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q))) : rs;
    $('dtRowsSub').textContent = `${list.length} แถว (ตามตัวกรองด้านบน) · คลิกหัวคอลัมน์เพื่อเรียงลำดับ`;
    const meta = Object.fromEntries(COLS.map(m => [m.key, m]));
    const keys = D.length ? Object.keys(D[0]) : [];
    const cols = keys.map(k => ({ key: k, label: (meta[k] && meta[k].label) || k,
      num: meta[k] ? meta[k].kind === 'int' || meta[k].kind === 'float' : typeof D[0][k] === 'number',
      fmt: meta[k] && meta[k].kind === 'float' ? f2 : undefined }));
    table($('dtTable'), cols, list);
    $('dtExport').onclick = () => downloadCSV('supply_chain_clean_filtered.csv', keys.map(k => ({ key: k, label: k })), list);
  }

  const RENDER = { overview: renderOverview, products: renderProducts, supplier: renderSupplier, inventory: renderInventory, logistics: renderLogistics, data: renderData };
  const currentPage = () => { const p = location.hash.slice(1); return PAGES[p] ? p : 'overview'; };

  function renderPage() {
    const page = currentPage(), rs = filtered();
    for (const k in PAGES) $('p-' + k).hidden = k !== page;
    document.querySelectorAll('.nav a').forEach(a => (a.dataset.page === page ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $('pageTitle').textContent = PAGES[page].t;
    $('pageDesc').textContent = PAGES[page].d;
    document.title = `${PAGES[page].t} · Supply Chain DSS`;
    $('fCount').textContent = `แสดง ${rs.length} จาก ${D.length} SKU`;
    Charts.hideTip();
    RENDER[page](rs);
  }

  // ---------- controls ----------
  function buildControls() {
    const fill = (sel, key, all) => {
      sel.replaceChildren(h('option', { value: '' }, all), ...uniq(key).map(v => h('option', { value: v }, lab(key, v))));
      sel.value = uniq(key).includes(S[key === 'product_type' ? 'type' : 'loc']) ? S[key === 'product_type' ? 'type' : 'loc'] : '';
    };
    fill($('fType'), 'product_type', 'ทุกประเภท');
    fill($('fLoc'), 'location', 'ทุกสถานที่');
    $('fType').addEventListener('change', e => { S.type = e.target.value; update(); });
    $('fLoc').addEventListener('change', e => { S.loc = e.target.value; update(); });
    $('fReset').addEventListener('click', () => { S.type = S.loc = ''; $('fType').value = $('fLoc').value = ''; update(); });

    // supplier
    segmented($('supMethod'), [['saw', 'SAW'], ['topsis', 'TOPSIS']], () => S.sup.method, v => { S.sup.method = v; update(); });
    const SUP_PRESETS = [
      ['ค่าเริ่มต้น', DEF.sup.w], ['สมดุล', { defect: 3, pass: 3, cost: 3, lead: 3, mfg: 3, cap: 3 }],
      ['เน้นคุณภาพ', { defect: 10, pass: 8, cost: 2, lead: 2, mfg: 1, cap: 1 }], ['เน้นต้นทุน', { defect: 3, pass: 2, cost: 10, lead: 2, mfg: 1, cap: 3 }],
      ['เน้นความเร็ว', { defect: 2, pass: 1, cost: 2, lead: 10, mfg: 7, cap: 3 }],
    ];
    $('supPresets').replaceChildren(...SUP_PRESETS.map(([n, w]) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { S.sup.w = { ...w }; update(); } }, n)));
    for (const c of SUP_CRIT) {
      const sl = slider({ label: c.label, hint: c.dir === 'min' ? 'ยิ่งต่ำยิ่งดี' : 'ยิ่งสูงยิ่งดี', min: 0, max: 10, value: S.sup.w[c.key], onInput: v => { S.sup.w[c.key] = v; update(); } });
      supUI[c.key] = sl;
      $('supSliders').append(sl.el);
    }

    // inventory
    const invDef = [
      ['P', 'ช่วงเวลาของยอดขายในข้อมูล', 'ไม่ทราบจากข้อมูล — สมมติฐาน', 30, 365, 5],
      ['SS', 'Safety stock', 'จำนวนวันสำรองกันความไม่แน่นอน', 0, 30, 1],
      ['cycle', 'รอบการสั่งซื้อ', 'สั่งให้พอใช้กี่วันหลังของเข้า', 7, 90, 1],
    ];
    for (const [k, label, hint, min, max, step] of invDef) {
      const sl = slider({ label, hint, min, max, step, value: S.inv[k], onInput: v => { S.inv[k] = v; update(); } });
      invUI[k] = sl;
      $('invSliders').append(sl.el);
    }
    segmented($('invView'), [['risk', 'ต้องดำเนินการ'], ['all', 'ทั้งหมด']], () => S.inv.view, v => { S.inv.view = v; update(); });
    $('invQ').value = S.inv.q;
    $('invQ').addEventListener('input', e => { S.inv.q = e.target.value; update(); });

    // logistics
    segmented($('logDim'), Object.entries(LOG_DIMS), () => S.log.dim, v => { S.log.dim = v; update(); });
    const LOG_PRESETS = [['ค่าเริ่มต้น', DEF.log.w], ['สมดุล', { cost: 5, time: 5, total: 5 }], ['เน้นประหยัด', { cost: 10, time: 2, total: 8 }], ['เน้นเร็ว', { cost: 2, time: 10, total: 2 }]];
    $('logPresets').replaceChildren(...LOG_PRESETS.map(([n, w]) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { S.log.w = { ...w }; update(); } }, n)));
    for (const c of LOG_CRIT) {
      const sl = slider({ label: c.label, min: 0, max: 10, value: S.log.w[c.key], onInput: v => { S.log.w[c.key] = v; update(); } });
      logUI[c.key] = sl;
      $('logSliders').append(sl.el);
    }

    $('dtQ').value = S.data.q;
    $('dtQ').addEventListener('input', e => { S.data.q = e.target.value; update(); });
  }

  // theme: system -> light -> dark
  const THEMES = ['system', 'light', 'dark'], THEME_LBL = { system: 'ธีม: ตามระบบ', light: 'ธีม: สว่าง', dark: 'ธีม: มืด' };
  function applyTheme(t) {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('themeLbl').textContent = THEME_LBL[t];
  }
  let theme = 'system';
  try { theme = localStorage.getItem('scdss-theme') || 'system'; } catch (e) { /* ignore */ }
  if (!THEMES.includes(theme)) theme = 'system';

  function init() {
    $('srcInfo').textContent = `ข้อมูล ${D.length} SKU · ${COLS.length} คอลัมน์`;
    applyTheme(theme);
    $('themeBtn').addEventListener('click', () => {
      theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
      try { localStorage.setItem('scdss-theme', theme); } catch (e) { /* ignore */ }
      applyTheme(theme);
      renderPage();
    });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderPage);
    initCards();
    buildControls();
    window.addEventListener('hashchange', () => { renderPage(); window.scrollTo(0, 0); });
    let lastW = 0, timer;
    new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      if (w === lastW) return;
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(renderPage, 120);
    }).observe($('main'));
    renderPage();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPage);
  }
  init();
})();
