"""Clean supply_chain_data.csv for the DSS web app.

Outputs (in web/):
  supply_chain_clean.csv  cleaned table
  data.js                 window.DATA (rows), window.REPORT (cleaning report), window.COLUMNS (metadata)
Run:  python clean.py
"""
import csv, json, os, sys, statistics as st
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")  # Thai output on Windows consoles

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'archive (1)', 'supply_chain_data.csv')
OUT = os.path.join(BASE, 'web')

# raw name -> (clean name, Thai label, kind). 'Lead times' and 'Lead time' are ambiguous, so they get distinct names.
COLS = {
    'Product type':            ('product_type',       'ประเภทสินค้า',            'cat'),
    'SKU':                     ('sku',                'รหัสสินค้า (SKU)',        'id'),
    'Price':                   ('price',              'ราคาต่อหน่วย',            'float'),
    'Availability':            ('availability',       'ความพร้อมจำหน่าย (%)',    'int'),
    'Number of products sold': ('units_sold',         'จำนวนที่ขายได้',           'int'),
    'Revenue generated':       ('revenue',            'รายได้',                  'float'),
    'Customer demographics':   ('customer_demo',      'กลุ่มลูกค้า',              'cat'),
    'Stock levels':            ('stock',              'สต็อกคงเหลือ',            'int'),
    'Lead times':              ('order_lead_days',    'Lead time คำสั่งซื้อ (วัน)', 'int'),
    'Order quantities':        ('order_qty',          'ปริมาณสั่งซื้อ',           'int'),
    'Shipping times':          ('ship_days',          'เวลาขนส่ง (วัน)',         'int'),
    'Shipping carriers':       ('carrier',            'ผู้ให้บริการขนส่ง',        'cat'),
    'Shipping costs':          ('ship_cost',          'ค่าขนส่ง',                'float'),
    'Supplier name':           ('supplier',           'ซัพพลายเออร์',            'cat'),
    'Location':                ('location',           'สถานที่',                 'cat'),
    'Lead time':               ('supplier_lead_days', 'Lead time ซัพพลายเออร์ (วัน)', 'int'),
    'Production volumes':      ('prod_volume',        'ปริมาณการผลิต',           'int'),
    'Manufacturing lead time': ('mfg_lead_days',      'เวลาผลิต (วัน)',           'int'),
    'Manufacturing costs':     ('mfg_cost',           'ต้นทุนการผลิต',           'float'),
    'Inspection results':      ('inspection',         'ผลตรวจคุณภาพ',            'cat'),
    'Defect rates':            ('defect_rate',        'อัตราของเสีย (%)',         'float'),
    'Transportation modes':    ('transport',          'รูปแบบการขนส่ง',          'cat'),
    'Routes':                  ('route',              'เส้นทาง',                 'cat'),
    'Costs':                   ('total_cost',         'ต้นทุนรวม',               'float'),
}
# valid ranges; rows outside are removed
RANGE = {'price': (0, None), 'availability': (0, 100), 'units_sold': (0, None), 'revenue': (0, None),
         'stock': (0, None), 'order_qty': (0, None), 'ship_cost': (0, None), 'mfg_cost': (0, None),
         'defect_rate': (0, 100), 'total_cost': (0, None), 'prod_volume': (0, None)}
for c in ('order_lead_days', 'ship_days', 'supplier_lead_days', 'mfg_lead_days'):
    RANGE[c] = (0, 365)
CANON = {'product_type': str.lower, 'inspection': str.title, 'transport': str.title}  # unify casing
MISSING = {'', 'na', 'n/a', 'nan', 'null', 'none', '-'}


def profile(rows, key, kind):
    vals = [r[key] for r in rows]
    blank = sum(1 for v in vals if v is None or (isinstance(v, str) and v.strip().lower() in MISSING))
    p = {'missing': blank, 'unique': len(set(map(str, vals)))}
    if kind in ('int', 'float'):
        nums = [float(v) for v in vals if v not in (None, '') and _isnum(v)]
        if nums:
            q1, _, q3 = st.quantiles(nums, n=4)
            iqr = q3 - q1
            p.update(min=round(min(nums), 2), max=round(max(nums), 2), mean=round(st.mean(nums), 2),
                     median=round(st.median(nums), 2), std=round(st.pstdev(nums), 2),
                     outliers=sum(1 for v in nums if v < q1 - 1.5 * iqr or v > q3 + 1.5 * iqr))
    elif kind == 'cat':
        p['values'] = dict(Counter(map(str, vals)).most_common())
    return p


def _isnum(v):
    try:
        float(v); return True
    except (TypeError, ValueError):
        return False


raw = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
raw = [{k.strip(): v for k, v in r.items()} for r in raw]
rep = {'source': os.path.relpath(SRC, BASE), 'rows_in': len(raw), 'cols_in': len(raw[0]) if raw else 0,
       'steps': [], 'observations': []}
before = {c: profile(raw, c, kind) for c, (_, _, kind) in COLS.items()}

# 1. trim whitespace + unify casing
trimmed = recased = 0
for r in raw:
    for k, v in r.items():
        if v != v.strip():
            r[k] = v.strip(); trimmed += 1
rep['steps'].append({'name': 'ตัดช่องว่างหัว-ท้ายข้อความ', 'affected': trimmed})

# 2. rename + convert types
rows, bad_type, missing_filled = [], 0, 0
for r in raw:
    o, ok = {}, True
    for rawk, (k, _, kind) in COLS.items():
        v = r.get(rawk, '')
        if v.lower() in MISSING:
            v = None
        if kind in ('int', 'float'):
            if v is None or not _isnum(v):
                o[k] = None
            else:
                o[k] = int(round(float(v))) if kind == 'int' else round(float(v), 2)
        else:
            if v is not None and k in CANON and CANON[k](v) != v:
                v = CANON[k](v); recased += 1
            o[k] = v
    rows.append(o)
rep['steps'].append({'name': 'เปลี่ยนชื่อคอลัมน์เป็น snake_case (แยก Lead times / Lead time ที่กำกวม)', 'affected': len(COLS)})
rep['steps'].append({'name': 'แปลงชนิดข้อมูล (จำนวนเต็ม / ทศนิยม 2 ตำแหน่ง)', 'affected': len(rows)})
rep['steps'].append({'name': 'ปรับตัวพิมพ์ของหมวดหมู่ให้สม่ำเสมอ', 'affected': recased})

# 3. missing values: numeric -> median of product type, categorical -> 'Unknown'; rows without SKU dropped
num_cols = [k for k, _, kind in COLS.values() if kind in ('int', 'float')]
no_sku = [o for o in rows if not o['sku']]
rows = [o for o in rows if o['sku']]
for k in num_cols:
    for o in rows:
        if o[k] is None:
            peers = [p[k] for p in rows if p[k] is not None and p['product_type'] == o['product_type']]
            o[k] = round(st.median(peers), 2) if peers else 0
            missing_filled += 1
for k, _, kind in COLS.values():
    if kind == 'cat':
        for o in rows:
            if o[k] is None:
                o[k] = 'Unknown'; missing_filled += 1
rep['steps'].append({'name': 'จัดการค่าว่าง (ตัวเลขเติมด้วยมัธยฐานของประเภทสินค้า, หมวดหมู่เติม Unknown, ไม่มี SKU ลบทิ้ง)',
                     'affected': missing_filled + len(no_sku)})

# 4. duplicates (exact rows, then SKU)
seen_row, seen_sku, dedup, dups = set(), set(), [], 0
for o in rows:
    sig = json.dumps(o, sort_keys=True)
    if sig in seen_row or o['sku'] in seen_sku:
        dups += 1; continue
    seen_row.add(sig); seen_sku.add(o['sku']); dedup.append(o)
rows = dedup
rep['steps'].append({'name': 'ลบแถวซ้ำ / SKU ซ้ำ', 'affected': dups})

# 5. range validation
valid, out_of_range = [], 0
for o in rows:
    if any((lo is not None and o[c] < lo) or (hi is not None and o[c] > hi) for c, (lo, hi) in RANGE.items()):
        out_of_range += 1; continue
    valid.append(o)
rows = valid
rep['steps'].append({'name': 'ตรวจช่วงค่าที่เป็นไปได้ (เช่น % อยู่ระหว่าง 0–100, ค่าไม่ติดลบ)', 'affected': out_of_range})

# 6. derived fields
for o in rows:
    o['total_lead_days'] = o['supplier_lead_days'] + o['mfg_lead_days']
    o['sku_num'] = int(''.join(ch for ch in o['sku'] if ch.isdigit()) or 0)
rows.sort(key=lambda o: o['sku_num'])
for o in rows:
    del o['sku_num']
rep['steps'].append({'name': 'เพิ่มคอลัมน์ total_lead_days = Lead time ซัพพลายเออร์ + เวลาผลิต', 'affected': len(rows)})

rep['rows_out'] = len(rows)
rep['cols_out'] = len(rows[0]) if rows else 0
after = {k: profile(rows, k, kind) for k, _, kind in COLS.values()}

# observations that are reported but deliberately not "fixed"
def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** .5
    return num / den if den else 0
r_rev = corr([o['revenue'] for o in rows], [o['price'] * o['units_sold'] for o in rows])
rep['observations'].append(f'รายได้ (revenue) ไม่สอดคล้องกับ ราคา × จำนวนที่ขาย (สหสัมพันธ์ {r_rev:.2f}) จึงใช้คอลัมน์ revenue ตามต้นฉบับ ไม่คำนวณใหม่')
out_cols = [COLS_k for COLS_k, p in after.items() if p.get('outliers')]
rep['observations'].append('ค่าผิดปกติตามเกณฑ์ IQR: ' + (', '.join(f'{c} ({after[c]["outliers"]})' for c in out_cols) if out_cols else 'ไม่พบ') + ' — เก็บไว้ ไม่ลบ')
zero = sum(1 for o in rows if o['stock'] == 0)
if zero:
    rep['observations'].append(f'มี {zero} SKU ที่สต็อกเป็น 0 (หมดสต็อก) — เป็นข้อมูลจริงทางธุรกิจ ไม่ใช่ค่าผิดพลาด')
rep['observations'].append('ไม่ทราบช่วงเวลาของยอดขาย จึงให้ผู้ใช้กำหนดเองในหน้า “สต็อกสินค้า”')

meta = [{'raw': rawk, 'key': k, 'label': lab, 'kind': kind, 'before': before[rawk], 'after': after[k]}
        for rawk, (k, lab, kind) in COLS.items()]
meta.append({'raw': '(คำนวณ)', 'key': 'total_lead_days', 'label': 'Lead time รวม (วัน)', 'kind': 'int',
             'before': None, 'after': profile(rows, 'total_lead_days', 'int')})

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'supply_chain_clean.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
with open(os.path.join(OUT, 'data.js'), 'w', encoding='utf-8') as f:
    f.write('// generated by clean.py - do not edit\n')
    for name, obj in (('DATA', rows), ('REPORT', rep), ('COLUMNS', meta)):
        f.write(f'window.{name}={json.dumps(obj, ensure_ascii=False)};\n')
print(f"rows {rep['rows_in']} -> {rep['rows_out']}")
for s in rep['steps']:
    print(f"  {s['affected']:>4}  {s['name']}")
for ob in rep['observations']:
    print('  *', ob)
