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
}

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
    const meta = cfg.fields.map(f =>
      '<span><i>' + esc(f.label) + '</i> ' + esc(f.date ? fmtDate(r[f.k]) : (r[f.k] ?? '')) + '</span>').join('');
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
  } catch (e) { alert('保存失败：' + e.message); }
}
async function deleteModule(mod, id) {
  const cfg = MODULES[mod];
  if (!confirm('确定删除这条' + cfg.title + '记录吗？')) return;
  try {
    await sbDelete(cfg.table, id);
    state[mod] = state[mod].filter(x => String(x.id) !== String(id));
    renderModule(mod);
    renderStats();
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

// 导出 CSV（带 UTF-8 BOM，Excel 打开中文不乱码）
function exportModuleCsv(mod) {
  const cfg = MODULES[mod];
  const rows = moduleRows(mod);
  const head = cfg.fields.map(f => csvEscape(f.label)).join(',');
  const lines = rows.map(r => cfg.fields.map(f => csvEscape(f.date ? fmtDate(r[f.k]) : (r[f.k] ?? ''))).join(','));
  download(cfg.title + '-' + new Date().toISOString().slice(0, 10) + '.csv', '﻿' + [head].concat(lines).join('\n'), 'text/csv;charset=utf-8');
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
  if (t.dataset.modDel) { await deleteModule(t.dataset.modDel, t.dataset.id); return; }
  if (t.dataset.export) { exportModuleCsv(t.dataset.export); return; }
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
function renderTasks() {
  renderStats();
  const tasks = state.tasks;
  const starredList = tasks.filter(t => t.starred && !t.done);
  document.getElementById('starredList').innerHTML = starredList.length
    ? starredList.map(t => '<div class="task"><span class="task-main"><span class="task-title">' + esc(t.title) + '</span><span class="task-meta"><span class="pill ' + t.priority + '">' + priorityLabel(t.priority) + '优先级</span>' + (t.due_date ? '<span>截止 ' + esc(t.due_date) + '</span>' : '') + '</span></span></div>').join('')
    : '<div class="empty">还没有今日重点，点击任务旁的 ★ 即可置顶到这里。</div>';
  let list = tasks;
  if (tasksFilter === 'active') list = tasks.filter(t => !t.done);
  if (tasksFilter === 'done') list = tasks.filter(t => t.done);
  document.getElementById('taskList').innerHTML = list.length
    ? list.map(t => `
      <div class="task ${t.done ? 'done' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} data-toggle="${t.id}" aria-label="完成">
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="pill ${t.priority}">${priorityLabel(t.priority)}优先级</span>
            ${t.due_date ? `<span>截止 ${esc(t.due_date)}</span>` : ''}
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
      </div>`).join('')
    : '<div class="empty">暂无待办，先添加一个吧。</div>';
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
  try {
    const inserted = await sbInsert('panel_tasks', { title, priority, due_date: due, done: false, starred: false });
    if (inserted && inserted[0]) state.tasks.unshift(inserted[0]);
    document.getElementById('newTitle').value = '';
    document.getElementById('newDue').value = '';
    renderTasks();
  } catch (e) { alert('添加失败：' + e.message); }
}
async function updateTask(id, patch) {
  try {
    await sbUpdate('panel_tasks', id, patch);
    state.tasks = state.tasks.map(t => String(t.id) === String(id) ? Object.assign({}, t, patch) : t);
    renderTasks();
  } catch (e) { alert('保存失败：' + e.message); }
}
async function deleteTask(id) {
  if (!confirm('确定删除这条待办吗？')) return;
  try {
    await sbDelete('panel_tasks', id);
    state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
    renderTasks();
  } catch (e) { alert('删除失败：' + e.message); }
}
document.getElementById('addBtn').addEventListener('click', addTask);
document.getElementById('newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
  tasksFilter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  renderTasks();
}));
document.getElementById('taskList').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.toggle) { const task = state.tasks.find(x => String(x.id) === t.dataset.toggle); await updateTask(task.id, { done: !task.done }); }
  if (t.dataset.star) { const task = state.tasks.find(x => String(x.id) === t.dataset.star); await updateTask(task.id, { starred: !task.starred }); }
  if (t.dataset.del) await deleteTask(t.dataset.del);
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
  Object.keys(MODULES).forEach(exportModuleCsv);
});
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
