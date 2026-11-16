// 工作面板 v2 - Vercel + Supabase 版
// 关键修复：v1 用外部 @supabase/supabase-js CDN，CDN 一卡页面就永远停在“加载中”。
// v2 不依赖任何外部 JS 库，直接用 fetch() 调 Supabase REST API，
// 每次请求 10 秒超时，失败会在对应列表里显示错误，不会无限挂起。
const SUPABASE_URL = 'https://gplkvdodbfzknyafdttb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwbGt2ZG9kYmZ6a255YWZkdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MDY5NDIsImV4cCI6MjExMDE4Mjk0Mn0.nYHIDlveuqhgwRquL_DgIzWYtUog3SaIS2ABjQTci1g';

const statusEl = document.getElementById('status');
const hasKey = SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== '__SUPABASE_ANON_KEY__';
if (!hasKey) {
  statusEl.textContent = '未配置 Supabase anon key：数据暂不保存到云端。';
  statusEl.classList.add('error');
}

// ---------- Supabase REST（fetch 直调，10 秒超时） ----------
async function sb(table, opts) {
  opts = opts || {};
  const method = opts.method || 'GET';
  let url = SUPABASE_URL + '/rest/v1/' + table;
  if (opts.query) url += '?' + opts.query;
  if (opts.id) url += '?id=eq.' + encodeURIComponent(opts.id);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 200));
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（10 秒），请检查网络后重试');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
const sbList = (t, order) => sb(t, { query: 'select=*&order=' + (order || 'created_at.desc') });
const sbInsert = (t, row) => sb(t, { method: 'POST', body: row });
const sbUpdate = (t, id, patch) => sb(t, { method: 'PATCH', id, body: patch });
const sbDelete = (t, id) => sb(t, { method: 'DELETE', id });

// ---------- 通用工具 ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(d) { return d ? String(d).slice(0, 10) : '—'; }
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- 标签页 ----------
document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + b.dataset.tab));
});

// ---------- 日期 / 顶部统计 ----------
function renderDate() {
  const now = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  document.getElementById('today').textContent =
    now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + week;
}
function renderStats() {
  document.getElementById('statInquiries').textContent =
    state.inquiries.filter(i => i.status === '待报价' || i.status === '跟进中').length;
  document.getElementById('statOrders').textContent =
    state.orders.filter(o => o.pay_status !== '已付清' || o.progress !== '已完成').length;
  document.getElementById('statShipments').textContent =
    state.shipments.filter(s => s.status !== '已签收').length;
  document.getElementById('statSeo').textContent =
    state.seo.filter(s => s.status === '待写' || s.status === '写作中').length;
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.done).length;
  document.getElementById('countTotal').textContent = total;
  document.getElementById('countStarred').textContent = state.tasks.filter(t => t.starred && !t.done).length;
  // 今天必办 = 未完成待办里“已逾期 + 今天到期”的条数
  document.getElementById('statTodayMust').textContent =
    state.tasks.filter(t => !t.done && (taskTimeGroup(t) === 'overdue' || taskTimeGroup(t) === 'today')).length;
}

// ---------- 时间分组（本地日期，避免 UTC 时区差一天） ----------
// 日期一律按本地年月日比较：due_date 是 YYYY-MM-DD，按本地时区解析成午夜，
// 与本地今天相减得到天数差。不要用 new Date('YYYY-MM-DD')（按 UTC 解析会差一天）。
function localDayStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayStr() { return localDayStr(new Date()); }
function dayDiff(dateStr, refStr) {
  const p = String(dateStr).slice(0, 10).split('-').map(Number);
  const r = String(refStr).slice(0, 10).split('-').map(Number);
  const a = new Date(p[0], p[1] - 1, p[2]);
  const b = new Date(r[0], r[1] - 1, r[2]);
  return Math.round((a - b) / 86400000);
}
function taskTimeGroup(t) {
  if (!t.due_date) return 'none';
  const d = dayDiff(t.due_date, todayStr());
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return 'later';
}
function overdueDays(t) {
  if (!t.due_date) return 0;
  const d = dayDiff(t.due_date, todayStr());
  return d < 0 ? -d : 0;
}
const TIME_GROUPS = [
  { key: 'overdue', icon: '🔴', label: '已逾期' },
  { key: 'today', icon: '🟡', label: '今天到期' },
  { key: 'tomorrow', icon: '🔵', label: '明天到期' },
  { key: 'later', icon: '⚪', label: '以后到期' },
  { key: 'none', icon: '⚪', label: '无截止日期' }
];

// ---------- 状态与模块配置 ----------
const state = { tasks: [], links: [], inquiries: [], suppliers: [], seo: [], orders: [], shipments: [] };
const loadError = {};   // table -> 错误信息
const editing = {};     // module -> 正在编辑的 id（null 表示新增）

const MODULES = {
  inquiries: {
    table: 'panel_inquiries', title: '询盘', required: 'customer',
    fields: [
      { k: 'customer', label: '客人/公司' }, { k: 'product', label: '产品' },
      { k: 'quantity', label: '数量' }, { k: 'status', label: '报价状态' },
      { k: 'followup', label: '跟进记录' }, { k: 'inquiry_date', label: '日期', date: true }
    ],
    statusField: 'status'
  },
  suppliers: {
    table: 'panel_suppliers', title: '供应商', required: 'name',
    fields: [
      { k: 'name', label: '供应商' }, { k: 'product', label: '产品' },
      { k: 'price', label: '价格' }, { k: 'moq', label: '起订量' },
      { k: 'contact', label: '联系人' }, { k: 'phone', label: '联系方式' }
    ]
  },
  seo: {
    table: 'panel_seo', title: 'SEO', required: 'keyword',
    fields: [
      { k: 'keyword', label: '关键词' }, { k: 'rank', label: '当前排名' },
      { k: 'target_rank', label: '目标排名' }, { k: 'page', label: '文章/页面' },
      { k: 'status', label: '进度状态' }, { k: 'updated_date', label: '更新日期', date: true }
    ],
    statusField: 'status'
  },
  orders: {
    table: 'panel_orders', title: '订单/PI', required: 'order_no',
    fields: [
      { k: 'order_no', label: '订单号' }, { k: 'customer', label: '客人' },
      { k: 'supplier', label: '供应商' }, { k: 'product', label: '产品' },
      { k: 'amount', label: '金额' }, { k: 'currency', label: '货币' },
      { k: 'pi_no', label: 'PI号' }, { k: 'pay_status', label: '付款状态' },
      { k: 'progress', label: '生产进度' }
    ],
    statusField: 'pay_status'
  },
  shipments: {
    table: 'panel_shipments', title: '发货', required: 'customer',
    fields: [
      { k: 'customer', label: '客人' }, { k: 'order_no', label: '订单号' },
      { k: 'carrier', label: '快递公司' }, { k: 'tracking', label: '快递单号' },
      { k: 'ship_date', label: '发货日期', date: true }, { k: 'status', label: '状态' },
      { k: 'note', label: '备注' }
    ],
    statusField: 'status'
  }
};

// ---------- 通用模块：加载 / 渲染 / 增删改 ----------
function moduleRows(mod) {
  const cfg = MODULES[mod];
  let rows = state[mod].slice();
  const q = (document.getElementById('search-' + mod).value || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => cfg.fields.some(f => String(r[f.k] ?? '').toLowerCase().includes(q)));
  const fEl = document.getElementById('filter-' + mod);
  if (fEl && fEl.value) rows = rows.filter(r => String(r[cfg.statusField] ?? '') === fEl.value);
  return rows;
}
function renderModule(mod) {
  const cfg = MODULES[mod];
  const el = document.getElementById('list-' + mod);
  if (loadError[cfg.table]) {
    el.innerHTML = '<div class="empty error-box">加载失败：' + esc(loadError[cfg.table]) +
      ' <button class="small" data-retry="' + mod + '">重试</button></div>';
    return;
  }
  const rows = moduleRows(mod);
  if (!rows.length) { el.innerHTML = '<div class="empty">暂无记录，先在上面添加一条吧。</div>'; return; }
  el.innerHTML = rows.map(r => {
    const main = cfg.fields.slice(0, 3).map(f => '<b>' + esc(f.date ? fmtDate(r[f.k]) : r[f.k]) + '</b>').join(' · ');
    const meta = cfg.fields.map(f => {
      const val = f.date ? fmtDate(r[f.k]) : (r[f.k] ?? '');
      // 询盘逾期提醒：inquiry_date 早于今天、且未成交/未丢单的，日期标红并加“已逾期 N 天”
      if (mod === 'inquiries' && f.k === 'inquiry_date' && r.inquiry_date) {
        const d = dayDiff(r.inquiry_date, todayStr());
        const closed = r.status === '已成交' || r.status === '已丢单';
        if (d < 0 && !closed) {
          return '<span><i>' + esc(f.label) + '</i> <span class="overdue-text">' + esc(val) + '</span>' +
            ' <span class="overdue-badge">已逾期 ' + (-d) + ' 天</span></span>';
        }
      }
      return '<span><i>' + esc(f.label) + '</i> ' + esc(val) + '</span>';
    }).join('');
    return '<div class="mod-row">' +
      '<div class="mod-main"><div class="mod-title">' + main + '</div><div class="mod-meta">' + meta + '</div></div>' +
      '<div class="task-actions">' +
      '<button class="small ghost" data-mod-edit="' + mod + '" data-id="' + r.id + '">编辑</button>' +
      '<button class="small danger" data-mod-del="' + mod + '" data-id="' + r.id + '">删除</button>' +
      '</div></div>';
  }).join('');
}
function readForm(mod) {
  const row = {};
  document.querySelectorAll('#form-' + mod + ' [data-f]').forEach(inp => {
    row[inp.dataset.f] = inp.value.trim() === '' && inp.tagName === 'SELECT' ? inp.value : inp.value;
    if (inp.type === 'date' && !inp.value) row[inp.dataset.f] = null;
  });
  return row;
}
function fillForm(mod, r) {
  document.querySelectorAll('#form-' + mod + ' [data-f]').forEach(inp => {
    inp.value = r[inp.dataset.f] ?? '';
  });
}
function clearForm(mod) {
  document.querySelectorAll('#form-' + mod + ' [data-f]').forEach(inp => { inp.value = ''; });
  const cfg = MODULES[mod];
  const firstSelect = document.querySelector('#form-' + mod + ' select[data-f]');
  if (firstSelect) firstSelect.selectedIndex = 0;
  editing[mod] = null;
  const saveBtn = document.querySelector('#form-' + mod + ' [data-save]');
  if (saveBtn) saveBtn.textContent = cfg.title === '询盘' ? '添加询盘' : cfg.title === '供应商' ? '添加供应商' : cfg.title === 'SEO' ? '添加关键词' : cfg.title === '订单/PI' ? '添加订单' : '添加发货';
  const cancelBtn = document.querySelector('#form-' + mod + ' [data-cancel]');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}
async function saveModule(mod) {
  const cfg = MODULES[mod];
  const row = readForm(mod);
  if (!row[cfg.required]) { alert('请至少填写 ' + cfg.fields.find(f => f.k === cfg.required).label); return; }
  if (!hasKey) { alert('未配置 Supabase key，无法保存'); return; }
  const saveBtn = document.querySelector('#form-' + mod + ' [data-save]');
  const saveLabel = saveBtn ? saveBtn.textContent : '';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中…'; }
  setStatus('正在保存' + cfg.title + '，请稍候…');
  try {
    if (editing[mod]) {
      row.updated_at = new Date().toISOString();
      const updated = await sbUpdate(cfg.table, editing[mod], row);
      const fresh = updated && updated[0] ? updated[0] : Object.assign({ id: editing[mod] }, row);
      state[mod] = state[mod].map(x => String(x.id) === String(editing[mod]) ? fresh : x);
    } else {
      const inserted = await sbInsert(cfg.table, row);
      const fresh = inserted && inserted[0] ? inserted[0] : row;
      state[mod].unshift(fresh);
    }
    clearForm(mod);
    renderModule(mod);
    renderStats();
    setStatus('已保存' + cfg.title + '。');
  } catch (e) { alert('保存失败：' + e.message); }
  finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = saveLabel; }
  }
}
async function deleteModule(mod, id) {
  const cfg = MODULES[mod];
  setStatus('正在删除' + cfg.title + '，请稍候…');
  try {
    await sbDelete(cfg.table, id);
    state[mod] = state[mod].filter(x => String(x.id) !== String(id));
    renderModule(mod);
    renderStats();
    setStatus(cfg.title + '已删除。');
  } catch (e) { alert('删除失败：' + e.message); }
}
async function loadModule(mod) {
  const cfg = MODULES[mod];
  try {
    const data = await sbList(cfg.table, mod === 'seo' ? 'updated_date.desc' : 'created_at.desc');
    state[mod] = data || [];
    delete loadError[cfg.table];
  } catch (e) {
    loadError[cfg.table] = e.message;
    state[mod] = [];
  }
  renderModule(mod);
  renderStats();
}

// ---------- 导出：CSV / Excel(.xlsx) / PDF（打印保存）/ Word(.doc) ----------
// 设计：页面加载时不引入任何外部 JS 库。点“导出 Excel”时才按需（lazy）加载
// SheetJS；加载失败则自动改用 .xls 表格版（Excel 可直接打开），按钮永不落空。
// PDF 不用重型库：生成打印版表格 + window.print()，用户在打印对话框选
// “另存为 PDF”即可保存为 PDF（A4 横向），按钮如实标注“导出 PDF（打印保存）”。
// Word 用 HTML 表格生成 .doc，Word 原生支持打开，UTF-8 编码中文不乱码。

// 纯函数（不碰 DOM，可被 Node 测试抽取验证），起止标记供测试脚本定位：
// __PURE_EXPORT_HELPERS_START__
function tableHtml(columns, rows) {
  const head = '<thead><tr>' + columns.map(c => '<th>' + esc(c.label) + '</th>').join('') + '</tr></thead>';
  const body = '<tbody>' + rows.map(r =>
    '<tr>' + columns.map(c => '<td>' + esc(String(c.value(r) ?? '')) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  return '<table>' + head + body + '</table>';
}
function buildDocHtml(title, sections) {
  const parts = sections.map(s => '<h2>' + esc(s.heading) + '</h2>' +
    (s.rows.length ? tableHtml(s.columns, s.rows) : '<p>暂无记录</p>')).join('');
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px;text-align:left}h1{font-size:18px}h2{font-size:15px}</style></head><body><h1>' + esc(title) + '</h1><p>导出时间：' + esc(new Date().toLocaleString('zh-CN')) + '</p>' + parts + '</body></html>';
}
function buildXlsHtml(title, sections) {
  const parts = sections.map(s => '<h2>' + esc(s.heading) + '</h2>' +
    (s.rows.length ? tableHtml(s.columns, s.rows) : '<p>暂无记录</p>')).join('');
  return '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><title>' + esc(title) + '</title></head><body><h1>' + esc(title) + '</h1>' + parts + '</body></html>';
}
function buildCsvText(columns, rows) {
  const head = columns.map(c => csvEscape(c.label)).join(',');
  const lines = rows.map(r => columns.map(c => csvEscape(c.value(r))).join(','));
  return '\ufeff' + [head].concat(lines).join('\n');
}
function rowsToAoa(columns, rows) {
  return [columns.map(c => c.label)].concat(rows.map(r => columns.map(c => c.value(r))));
}
function sheetName(name) {
  return String(name).replace(/[\\/?*\[\]:]/g, '').slice(0, 31) || 'Sheet1';
}
function fileDate() { return new Date().toISOString().slice(0, 10); }
// __PURE_EXPORT_HELPERS_END__

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', !!isError);
}

// 每个可导出模块的导出规格：标题 + 列定义（label + 取值函数）+ 当前筛选后的行。
// 待办按当前筛选（全部/未完成/今天必办/已完成），业务模块按当前搜索+状态筛选导出。
function filteredTasks() {
  if (tasksFilter === 'active') return state.tasks.filter(t => !t.done);
  if (tasksFilter === 'done') return state.tasks.filter(t => t.done);
  if (tasksFilter === 'todayMust') return state.tasks.filter(t => !t.done && (taskTimeGroup(t) === 'overdue' || taskTimeGroup(t) === 'today'));
  return state.tasks.slice();
}
function exportSpec(key) {
  if (key === 'tasks') {
    return {
      title: '待办', columns: [
        { label: '待办内容', value: r => r.title || '' },
        { label: '优先级', value: r => priorityLabel(r.priority) },
        { label: '截止日期', value: r => fmtDate(r.due_date) },
        { label: '完成状态', value: r => r.done ? '已完成' : '未完成' },
        { label: '今日重点', value: r => r.starred ? '是' : '否' },
        { label: '创建日期', value: r => r.created_at ? fmtDate(r.created_at) : '' }
      ], rows: filteredTasks()
    };
  }
  if (key === 'links') {
    return {
      title: '常用链接', columns: [
        { label: '名称', value: r => r.title || '' },
        { label: '网址', value: r => r.url || '' },
        { label: '创建日期', value: r => r.created_at ? fmtDate(r.created_at) : '' }
      ], rows: state.links.slice()
    };
  }
  if (key === 'notes') {
    return {
      title: '速记', columns: [
        { label: '内容', value: r => r.content || '' },
        { label: '更新日期', value: r => r.updated_at ? fmtDate(r.updated_at) : '' }
      ], rows: [{ content: document.getElementById('notes').value, updated_at: new Date().toISOString() }]
    };
  }
  const cfg = MODULES[key];
  return {
    title: cfg.title, columns: cfg.fields.map(f => ({
      label: f.label, value: r => f.date ? fmtDate(r[f.k]) : String(r[f.k] ?? '')
    })), rows: moduleRows(key)
  };
}

// 导出 CSV（带 UTF-8 BOM，Excel 打开中文不乱码）
function exportModuleCsv(mod) {
  const spec = exportSpec(mod);
  download(spec.title + '-' + fileDate() + '.csv', buildCsvText(spec.columns, spec.rows), 'text/csv;charset=utf-8');
  setStatus('已导出 CSV：' + spec.title + '，共 ' + spec.rows.length + ' 条。');
}

// 导出 .xls 表格版（HTML 表格存为 .xls，Excel 可直接打开；也是 Excel 组件加载失败时的兜底）
function exportToXls(key) {
  const spec = exportSpec(key);
  const html = buildXlsHtml('工作面板 - ' + spec.title, [{ heading: spec.title, columns: spec.columns, rows: spec.rows }]);
  downloadBlob(spec.title + '-' + fileDate() + '.xls', new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  setStatus('已导出 .xls 表格版：' + spec.title + '（Excel 可直接打开），共 ' + spec.rows.length + ' 条。');
}

// 按需加载 SheetJS（只在点“导出 Excel”时加载一次，页面打开时不加载，不阻塞首屏）
let xlsxLoadPromise = null;
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    let done = false;
    const fail = err => { if (done) return; done = true; s.remove(); xlsxLoadPromise = null; reject(err); };
    const timer = setTimeout(() => fail(new Error('加载 Excel 组件超时（15 秒），请检查网络后重试')), 15000);
    s.onload = () => {
      if (done) return; done = true; clearTimeout(timer);
      window.XLSX ? resolve(window.XLSX) : fail(new Error('Excel 组件加载失败'));
    };
    s.onerror = () => fail(new Error('Excel 组件加载失败，请检查网络后重试'));
    document.head.appendChild(s);
  });
  return xlsxLoadPromise;
}

// 导出真正的 .xlsx（SheetJS 生成）；CDN 加载失败时自动改用 .xls 表格版
async function exportToXlsx(key) {
  const spec = exportSpec(key);
  try {
    const XLSX = await loadXlsxLib();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsToAoa(spec.columns, spec.rows)), sheetName(spec.title));
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(spec.title + '-' + fileDate() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    setStatus('已导出 Excel（.xlsx）：' + spec.title + '，共 ' + spec.rows.length + ' 条。');
  } catch (e) {
    setStatus('Excel 组件加载失败（' + e.message + '），已自动改为下载 .xls 表格版，Excel 可直接打开。', true);
    exportToXls(key);
  }
}

// 导出 Word（.doc，HTML 表格，Word 原生支持打开，UTF-8 中文不乱码）
function exportToDoc(key) {
  const spec = exportSpec(key);
  const html = buildDocHtml('工作面板 - ' + spec.title, [{ heading: spec.title, columns: spec.columns, rows: spec.rows }]);
  downloadBlob(spec.title + '-' + fileDate() + '.doc', new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' }));
  setStatus('已导出 Word（.doc）：' + spec.title + '，共 ' + spec.rows.length + ' 条。');
}

// 导出 PDF：生成打印版表格，打开浏览器打印对话框，选“另存为 PDF”即可保存（A4 横向）
function printSections(title, sections) {
  const area = document.getElementById('print-area');
  area.innerHTML = '<h1>' + esc(title) + '</h1><p class="print-meta">导出时间：' + esc(new Date().toLocaleString('zh-CN')) + '　·　在打印对话框中选择“另存为 PDF”即可保存为 PDF 文件</p>' +
    sections.map(s => '<h2>' + esc(s.heading) + '</h2>' +
      (s.rows.length ? tableHtml(s.columns, s.rows) : '<p>暂无记录</p>')).join('');
  document.body.classList.add('printing');
  const cleanup = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 30000); // 兜底：个别浏览器不触发 afterprint 时 30 秒后恢复页面
  window.print();
}
function exportToPdf(key) {
  const spec = exportSpec(key);
  printSections('工作面板 - ' + spec.title, [{ heading: spec.title, columns: spec.columns, rows: spec.rows }]);
}

// 按格式分发单个模块的导出（format 为空时默认 CSV，兼容旧的 data-export 用法）
function exportModule(mod, format) {
  if (format === 'xlsx') return exportToXlsx(mod);
  if (format === 'pdf') return exportToPdf(mod);
  if (format === 'doc') return exportToDoc(mod);
  return exportModuleCsv(mod);
}

// 全部模块的导出规格（工具页“导出全部”用，顺序与标签页一致）
function allExportSpecs() {
  return ['tasks', 'inquiries', 'suppliers', 'seo', 'orders', 'shipments', 'links', 'notes'].map(exportSpec);
}
// 全部数据导出一个 .xlsx 工作簿（每模块一个工作表）；CDN 失败时改用 .xls 表格版
async function exportAllXlsx() {
  const specs = allExportSpecs();
  try {
    const XLSX = await loadXlsxLib();
    const wb = XLSX.utils.book_new();
    specs.forEach(spec => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsToAoa(spec.columns, spec.rows)), sheetName(spec.title));
    });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob('work-panel-全部数据-' + fileDate() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    setStatus('已导出全部数据 Excel（.xlsx），共 ' + specs.length + ' 个工作表。');
  } catch (e) {
    setStatus('Excel 组件加载失败（' + e.message + '），已自动改为下载全部数据 .xls 表格版，Excel 可直接打开。', true);
    const html = buildXlsHtml('工作面板 - 全部数据', specs.map(s => ({ heading: s.title, columns: s.columns, rows: s.rows })));
    downloadBlob('work-panel-全部数据-' + fileDate() + '.xls', new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
  }
}
// 全部数据导出一个 Word（.doc），每模块一段表格
function exportAllDoc() {
  const specs = allExportSpecs();
  const html = buildDocHtml('工作面板 - 全部数据', specs.map(s => ({ heading: s.title, columns: s.columns, rows: s.rows })));
  downloadBlob('work-panel-全部数据-' + fileDate() + '.doc', new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' }));
  setStatus('已导出全部数据 Word（.doc），共 ' + specs.length + ' 个模块。');
}
// 全部数据导出 PDF（打印保存）：一次打印全部模块的表格
function exportAllPdf() {
  const specs = allExportSpecs();
  printSections('工作面板 - 全部数据', specs.map(s => ({ heading: s.title, columns: s.columns, rows: s.rows })));
}

// 全局事件委托：模块的保存 / 取消 / 编辑 / 删除 / 导出 / 重试 / 搜索 / 筛选
document.addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.save) { await saveModule(t.dataset.save); return; }
  if (t.dataset.cancel) { clearForm(t.dataset.cancel); return; }
  if (t.dataset.modEdit) {
    const mod = t.dataset.modEdit;
    const r = state[mod].find(x => String(x.id) === t.dataset.id);
    if (!r) return;
    editing[mod] = r.id;
    fillForm(mod, r);
    document.querySelector('#form-' + mod + ' [data-save]').textContent = '保存修改';
    document.querySelector('#form-' + mod + ' [data-cancel]').classList.remove('hidden');
    document.getElementById('form-' + mod).scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (t.dataset.modDel) {
    if (t.textContent === '确认删除？') { await deleteModule(t.dataset.modDel, t.dataset.id); }
    else {
      t.textContent = '确认删除？';
      setTimeout(() => { if (t.isConnected) t.textContent = '删除'; }, 3000);
    }
    return;
  }
  if (t.dataset.export) { exportModule(t.dataset.export, t.dataset.format); return; }
  if (t.dataset.retry) { await loadModule(t.dataset.retry); return; }
});
['inquiries', 'suppliers', 'seo', 'orders', 'shipments'].forEach(mod => {
  const s = document.getElementById('search-' + mod);
  if (s) s.addEventListener('input', () => renderModule(mod));
  const f = document.getElementById('filter-' + mod);
  if (f) f.addEventListener('change', () => renderModule(mod));
});

// ---------- 待办（v1 功能保留） ----------
let tasksFilter = 'all';
let editingId = null;
function priorityLabel(p) { return p === 'high' ? '高' : p === 'low' ? '低' : '中'; }
function taskRowHtml(t) {
  const od = overdueDays(t);
  return `
      <div class="task ${t.done ? 'done' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} data-toggle="${t.id}" aria-label="完成">
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="pill ${t.priority}">${priorityLabel(t.priority)}优先级</span>
            ${t.due_date ? `<span class="${od ? 'overdue-text' : ''}">截止 ${esc(t.due_date)}</span>` : ''}
            ${od ? `<span class="overdue-badge">逾期 ${od} 天</span>` : ''}
            <span>${t.created_at ? new Date(t.created_at).toLocaleDateString('zh-CN') : ''}</span>
          </div>
          ${editingId === String(t.id) ? `
            <div class="add-row" style="margin-top:8px">
              <input type="text" id="editTitle" value="${esc(t.title)}">
              <button class="small" data-save-edit="${t.id}">保存</button>
              <button class="small ghost" data-cancel-edit>取消</button>
            </div>` : ''}
        </div>
        <div class="task-actions">
          <button class="star ${t.starred ? 'on' : ''}" data-star="${t.id}" title="设为重点">★</button>
          <button class="small ghost" data-edit="${t.id}">编辑</button>
          <button class="small danger" data-del="${t.id}">删除</button>
        </div>
      </div>`;
}
function renderTasks() {
  renderStats();
  const tasks = state.tasks;
  const starredList = tasks.filter(t => t.starred && !t.done);
  document.getElementById('starredList').innerHTML = starredList.length
    ? starredList.map(t => '<div class="task"><span class="task-main"><span class="task-title">' + esc(t.title) + '</span><span class="task-meta"><span class="pill ' + t.priority + '">' + priorityLabel(t.priority) + '优先级</span>' + (t.due_date ? '<span>截止 ' + esc(t.due_date) + '</span>' : '') + (overdueDays(t) ? '<span class="overdue-badge">逾期 ' + overdueDays(t) + ' 天</span>' : '') + '</span></span></div>').join('')
    : '<div class="empty">还没有今日重点，点击任务旁的 ★ 即可置顶到这里。</div>';
  let list = tasks;
  if (tasksFilter === 'active') list = tasks.filter(t => !t.done);
  if (tasksFilter === 'done') list = tasks.filter(t => t.done);
  if (tasksFilter === 'todayMust') list = tasks.filter(t => !t.done && (taskTimeGroup(t) === 'overdue' || taskTimeGroup(t) === 'today'));
  const el = document.getElementById('taskList');
  if (!list.length) { el.innerHTML = '<div class="empty">暂无待办，先添加一个吧。</div>'; return; }
  // 已完成的保持原样平铺；未完成按时间分组，组内按截止日期从早到晚排，无日期的保持原顺序
  if (tasksFilter === 'done') { el.innerHTML = list.map(taskRowHtml).join(''); return; }
  const groups = TIME_GROUPS.map(g => ({
    key: g.key, icon: g.icon, label: g.label,
    rows: list.filter(t => taskTimeGroup(t) === g.key).sort((a, b) => {
      if (!a.due_date || !b.due_date) return 0;
      return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
    })
  })).filter(g => g.rows.length);
  el.innerHTML = groups.map(g =>
    '<div class="time-group' + (g.key === 'overdue' ? ' overdue' : g.key === 'today' ? ' today' : '') + '">' +
    '<h3 class="time-group-title">' + g.icon + ' ' + g.label + '（' + g.rows.length + '）</h3>' +
    g.rows.map(taskRowHtml).join('') +
    '</div>'
  ).join('');
}
async function loadTasks() {
  try {
    state.tasks = await sbList('panel_tasks') || [];
    delete loadError.panel_tasks;
  } catch (e) {
    loadError.panel_tasks = e.message;
    state.tasks = [];
    document.getElementById('taskList').innerHTML = '<div class="empty error-box">加载待办失败：' + esc(e.message) + ' <button class="small" id="retryTasks">重试</button></div>';
    document.getElementById('retryTasks').addEventListener('click', loadTasks);
  }
  renderTasks();
}
async function addTask() {
  const title = document.getElementById('newTitle').value.trim();
  const priority = document.getElementById('newPriority').value;
  const due = document.getElementById('newDue').value || null;
  if (!title) { alert('请先输入待办内容'); return; }
  if (!hasKey) { alert('未配置 Supabase key，无法保存'); return; }
  const addBtn = document.getElementById('addBtn');
  addBtn.disabled = true; addBtn.textContent = '添加中…';
  setStatus('正在添加待办，请稍候…');
  try {
    const inserted = await sbInsert('panel_tasks', { title, priority, due_date: due, done: false, starred: false });
    if (inserted && inserted[0]) state.tasks.unshift(inserted[0]);
    document.getElementById('newTitle').value = '';
    document.getElementById('newDue').value = '';
    renderTasks();
    setStatus('待办已添加。');
  } catch (e) { alert('添加失败：' + e.message); }
  finally { addBtn.disabled = false; addBtn.textContent = '添加'; }
}
async function updateTask(id, patch) {
  try {
    await sbUpdate('panel_tasks', id, patch);
    state.tasks = state.tasks.map(t => String(t.id) === String(id) ? Object.assign({}, t, patch) : t);
    renderTasks();
  } catch (e) { alert('保存失败：' + e.message); }
}
async function deleteTask(id) {
  setStatus('正在删除待办，请稍候…');
  try {
    await sbDelete('panel_tasks', id);
    state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
    renderTasks();
    setStatus('待办已删除。');
  } catch (e) { alert('删除失败：' + e.message); }
}
document.getElementById('addBtn').addEventListener('click', addTask);
document.getElementById('newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
  tasksFilter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  renderTasks();
}));
// 顶部“今天必办”数字可点：跳到待办标签页并只看已逾期 + 今天到期
document.getElementById('statTodayMustCard').addEventListener('click', () => {
  tasksFilter = 'todayMust';
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x.dataset.filter === 'todayMust'));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'tasks'));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'pane-tasks'));
  renderTasks();
  document.getElementById('pane-tasks').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.getElementById('taskList').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.toggle) { const task = state.tasks.find(x => String(x.id) === t.dataset.toggle); await updateTask(task.id, { done: !task.done }); }
  if (t.dataset.star) { const task = state.tasks.find(x => String(x.id) === t.dataset.star); await updateTask(task.id, { starred: !task.starred }); }
  if (t.dataset.del) {
    if (t.textContent === '确认删除？') { await deleteTask(t.dataset.del); }
    else {
      t.textContent = '确认删除？';
      setTimeout(() => { if (t.isConnected) t.textContent = '删除'; }, 3000);
    }
  }
  if (t.dataset.edit) { editingId = t.dataset.edit; renderTasks(); }
  if (t.dataset.cancelEdit) { editingId = null; renderTasks(); }
  if (t.dataset.saveEdit) {
    const v = document.getElementById('editTitle').value.trim();
    if (!v) return;
    editingId = null;
    await updateTask(t.dataset.saveEdit, { title: v });
  }
});

// ---------- 速记 ----------
async function loadNotes() {
  try {
    const data = await sbList('panel_notes', 'updated_at.desc');
    if (data && data[0]) {
      document.getElementById('notes').value = data[0].content || '';
      document.getElementById('notes').dataset.id = data[0].id;
    }
  } catch (e) { /* 速记加载失败不阻塞页面，保存时会提示 */ }
}
async function saveNotes() {
  const content = document.getElementById('notes').value;
  if (!hasKey) { alert('未配置 Supabase key，无法保存'); return; }
  const id = document.getElementById('notes').dataset.id;
  try {
    if (id) {
      await sbUpdate('panel_notes', id, { content, updated_at: new Date().toISOString() });
    } else {
      const data = await sbInsert('panel_notes', { content });
      if (data && data[0]) document.getElementById('notes').dataset.id = data[0].id;
    }
    statusEl.textContent = '速记已保存到 Supabase。';
  } catch (e) { alert('保存失败：' + e.message); }
}
document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);

// ---------- 常用链接 ----------
function renderLinks() {
  document.getElementById('linkList').innerHTML = state.links.length
    ? state.links.map(l => '<div class="link-row"><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.title) + '</a><button class="small danger" data-del-link="' + l.id + '">删除</button></div>').join('')
    : '<div class="empty">暂无常用链接。</div>';
}
async function loadLinks() {
  try {
    state.links = await sbList('panel_links') || [];
    delete loadError.panel_links;
  } catch (e) {
    loadError.panel_links = e.message;
    document.getElementById('linkList').innerHTML = '<div class="empty error-box">加载链接失败：' + esc(e.message) + '</div>';
  }
  renderLinks();
}
async function addLink() {
  const title = document.getElementById('linkTitle').value.trim();
  let url = document.getElementById('linkUrl').value.trim();
  if (!title || !url) { alert('请填写链接名称和网址'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!hasKey) { alert('未配置 Supabase key，无法保存'); return; }
  try {
    const data = await sbInsert('panel_links', { title, url });
    if (data && data[0]) state.links.unshift(data[0]);
    document.getElementById('linkTitle').value = '';
    document.getElementById('linkUrl').value = '';
    renderLinks();
  } catch (e) { alert('添加失败：' + e.message); }
}
document.getElementById('addLinkBtn').addEventListener('click', addLink);
document.getElementById('linkList').addEventListener('click', async e => {
  if (!e.target.dataset.delLink) return;
  try {
    await sbDelete('panel_links', e.target.dataset.delLink);
    state.links = state.links.filter(l => String(l.id) !== e.target.dataset.delLink);
    renderLinks();
  } catch (err) { alert('删除失败：' + err.message); }
});

// ---------- 番茄钟 ----------
let timerSeconds = 25 * 60, timerTotal = 25 * 60, timerId = null;
function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function renderTimer() { document.getElementById('timerDisplay').textContent = fmt(timerSeconds); }
document.querySelectorAll('[data-minutes]').forEach(b => b.addEventListener('click', () => {
  clearInterval(timerId); timerId = null;
  timerTotal = timerSeconds = Number(b.dataset.minutes) * 60;
  document.getElementById('timerToggle').textContent = '开始';
  document.querySelectorAll('[data-minutes]').forEach(x => x.classList.toggle('active', x === b));
  renderTimer();
}));
document.getElementById('timerToggle').addEventListener('click', () => {
  if (timerId) {
    clearInterval(timerId); timerId = null;
    document.getElementById('timerToggle').textContent = '继续';
    return;
  }
  document.getElementById('timerToggle').textContent = '暂停';
  timerId = setInterval(() => {
    timerSeconds--;
    renderTimer();
    if (timerSeconds <= 0) {
      clearInterval(timerId); timerId = null;
      document.getElementById('timerToggle').textContent = '开始';
      alert('时间到了，休息一下吧！');
      timerSeconds = timerTotal;
      renderTimer();
    }
  }, 1000);
});
document.getElementById('timerReset').addEventListener('click', () => {
  clearInterval(timerId); timerId = null;
  timerSeconds = timerTotal;
  document.getElementById('timerToggle').textContent = '开始';
  renderTimer();
});

// ---------- 备份：导出全部 JSON / 导入 JSON / 导出全部 CSV ----------
const ALL_TABLES = {
  panel_tasks: '待办', panel_inquiries: '询盘', panel_suppliers: '供应商',
  panel_seo: 'SEO进度', panel_orders: '订单PI', panel_shipments: '发货',
  panel_notes: '速记', panel_links: '常用链接'
};
document.getElementById('exportJsonBtn').addEventListener('click', async () => {
  const backup = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of Object.keys(ALL_TABLES)) {
    try { backup.tables[t] = await sbList(t); }
    catch (e) { backup.tables[t] = { error: e.message }; }
  }
  download('work-panel-backup-' + new Date().toISOString().slice(0, 10) + '.json',
    JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
});
document.getElementById('exportAllCsvBtn').addEventListener('click', () => {
  ['tasks', 'inquiries', 'suppliers', 'seo', 'orders', 'shipments', 'links'].forEach(exportModuleCsv);
});
document.getElementById('exportAllXlsxBtn').addEventListener('click', exportAllXlsx);
document.getElementById('exportAllPdfBtn').addEventListener('click', exportAllPdf);
document.getElementById('exportAllDocBtn').addEventListener('click', exportAllDoc);
document.getElementById('importJsonFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    const tables = backup.tables || backup;
    let total = 0;
    for (const [table, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows) || !ALL_TABLES[table]) continue;
      for (const row of rows) {
        const clean = Object.assign({}, row);
        delete clean.id; delete clean.created_at; delete clean.updated_at;
        await sbInsert(table, clean);
        total++;
      }
    }
    alert('导入完成，共导入 ' + total + ' 条记录。页面即将刷新。');
    location.reload();
  } catch (err) { alert('导入失败：' + err.message); }
  e.target.value = '';
});

// ---------- 启动：并行加载，任一失败只在对应列表报错，不阻塞其他模块 ----------
renderDate();
renderTimer();
renderTasks();
renderLinks();
Object.keys(MODULES).forEach(mod => renderModule(mod));
loadTasks();
loadNotes();
loadLinks();
Object.keys(MODULES).forEach(mod => loadModule(mod));
