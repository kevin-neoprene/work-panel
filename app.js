// 工作面板 - Vercel + Supabase 版
// Supabase 配置：把 __SUPABASE_ANON_KEY__ 换成你 Supabase 项目的 anon public key。
// 获取位置：Supabase 控制台 -> 项目设置 -> API -> anon public key
// 也可以用 Vercel 环境变量 SUPABASE_ANON_KEY 覆盖（见 README）。
const SUPABASE_URL = 'https://gplkvdodbfzknyafdttb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwbGt2ZG9kYmZ6a255YWZkdHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MDY5NDIsImV4cCI6MjExMDE4Mjk0Mn0.nYHIDlveuqhgwRquL_DgIzWYtUog3SaIS2ABjQTci1g';

const statusEl = document.getElementById('status');
const hasKey = SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== '__SUPABASE_ANON_KEY__';
let supabase = null;
if (hasKey && window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  statusEl.textContent = '未配置 Supabase anon key：请按 README 把 __SUPABASE_ANON_KEY__ 换成真实 key，或在 Vercel 设置环境变量 SUPABASE_ANON_KEY。数据暂不保存到云端。';
  statusEl.classList.add('error');
}

let tasks = [];
let links = [];
let filter = 'all';
let editingId = null;

// ---------- 日期 / 统计 ----------
function renderDate() {
  const now = new Date();
  const week = ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];
  document.getElementById('today').textContent =
    `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${week}`;
}
function renderStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const starred = tasks.filter(t => t.starred).length;
  document.getElementById('countTotal').textContent = total;
  document.getElementById('countDone').textContent = done;
  document.getElementById('countStarred').textContent = starred;
  document.getElementById('countRate').textContent = total ? Math.round(done / total * 100) + '%' : '0%';
}

// ---------- 待办 ----------
function filteredTasks() {
  if (filter === 'active') return tasks.filter(t => !t.done);
  if (filter === 'done') return tasks.filter(t => t.done);
  return tasks;
}
function priorityLabel(p) { return p === 'high' ? '高' : p === 'low' ? '低' : '中'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderTasks() {
  renderStats();
  const starredList = tasks.filter(t => t.starred && !t.done);
  document.getElementById('starredList').innerHTML = starredList.length
    ? starredList.map(t => `<div class="task"><span class="task-main"><span class="task-title">${esc(t.title)}</span><span class="task-meta"><span class="pill ${t.priority}">${priorityLabel(t.priority)}优先级</span>${t.due_date ? `<span>截止 ${esc(t.due_date)}</span>` : ''}</span></span></div>`).join('')
    : '<div class="empty">还没有今日重点，点击任务旁的 ★ 即可置顶到这里。</div>';

  const list = filteredTasks();
  document.getElementById('taskList').innerHTML = list.length
    ? list.map(t => `
      <div class="task ${t.done ? 'done' : ''}">
        <input type="checkbox" ${t.done ? 'checked' : ''} data-toggle="${t.id}" aria-label="完成">
        <div class="task-main">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="pill ${t.priority}">${priorityLabel(t.priority)}优先级</span>
            ${t.due_date ? `<span>截止 ${esc(t.due_date)}</span>` : ''}
            <span>${new Date(t.created_at).toLocaleDateString('zh-CN')}</span>
          </div>
          ${editingId === t.id ? `
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
  if (!supabase) { renderTasks(); return; }
  const { data, error } = await supabase.from('panel_tasks').select('*').order('created_at', { ascending: false });
  if (error) { statusEl.textContent = '加载待办失败：' + error.message; statusEl.classList.add('error'); return; }
  tasks = data || [];
  renderTasks();
}
async function addTask() {
  const title = document.getElementById('newTitle').value.trim();
  const priority = document.getElementById('newPriority').value;
  const due = document.getElementById('newDue').value || null;
  if (!title) { alert('请先输入待办内容'); return; }
  if (!supabase) { alert('请先配置 Supabase anon key'); return; }
  const { data, error } = await supabase.from('panel_tasks').insert({ title, priority, due_date: due, done: false, starred: false }).select().single();
  if (error) { alert('添加失败：' + error.message); return; }
  tasks.unshift(data);
  document.getElementById('newTitle').value = '';
  document.getElementById('newDue').value = '';
  renderTasks();
}
async function updateTask(id, patch) {
  if (!supabase) return;
  const { error } = await supabase.from('panel_tasks').update(patch).eq('id', id);
  if (error) { alert('保存失败：' + error.message); return; }
  tasks = tasks.map(t => t.id === id ? { ...t, ...patch } : t);
  renderTasks();
}
async function deleteTask(id) {
  if (!confirm('确定删除这条待办吗？')) return;
  if (!supabase) return;
  const { error } = await supabase.from('panel_tasks').delete().eq('id', id);
  if (error) { alert('删除失败：' + error.message); return; }
  tasks = tasks.filter(t => t.id !== id);
  renderTasks();
}

document.getElementById('addBtn').addEventListener('click', addTask);
document.getElementById('newTitle').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  renderTasks();
}));
document.getElementById('taskList').addEventListener('click', async e => {
  const t = e.target;
  if (t.dataset.toggle) { const task = tasks.find(x => String(x.id) === t.dataset.toggle); await updateTask(task.id, { done: !task.done }); }
  if (t.dataset.star) { const task = tasks.find(x => String(x.id) === t.dataset.star); await updateTask(task.id, { starred: !task.starred }); }
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
  if (!supabase) return;
  const { data, error } = await supabase.from('panel_notes').select('*').order('updated_at', { ascending: false }).limit(1);
  if (error) return;
  if (data && data[0]) {
    document.getElementById('notes').value = data[0].content || '';
    document.getElementById('notes').dataset.id = data[0].id;
  }
}
async function saveNotes() {
  const content = document.getElementById('notes').value;
  if (!supabase) { alert('请先配置 Supabase anon key'); return; }
  const id = document.getElementById('notes').dataset.id;
  let error;
  if (id) {
    ({ error } = await supabase.from('panel_notes').update({ content, updated_at: new Date().toISOString() }).eq('id', id));
  } else {
    const { data, error: e2 } = await supabase.from('panel_notes').insert({ content }).select().single();
    error = e2;
    if (data) document.getElementById('notes').dataset.id = data.id;
  }
  if (error) alert('保存失败：' + error.message);
  else statusEl.textContent = '速记已保存到 Supabase。';
}
document.getElementById('saveNotesBtn').addEventListener('click', saveNotes);

// ---------- 常用链接 ----------
function renderLinks() {
  document.getElementById('linkList').innerHTML = links.length
    ? links.map(l => `<div class="link-row"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a><button class="small danger" data-del-link="${l.id}">删除</button></div>`).join('')
    : '<div class="empty">暂无常用链接。</div>';
}
async function loadLinks() {
  if (!supabase) { renderLinks(); return; }
  const { data, error } = await supabase.from('panel_links').select('*').order('created_at', { ascending: false });
  if (error) return;
  links = data || [];
  renderLinks();
}
async function addLink() {
  const title = document.getElementById('linkTitle').value.trim();
  let url = document.getElementById('linkUrl').value.trim();
  if (!title || !url) { alert('请填写链接名称和网址'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!supabase) { alert('请先配置 Supabase anon key'); return; }
  const { data, error } = await supabase.from('panel_links').insert({ title, url }).select().single();
  if (error) { alert('添加失败：' + error.message); return; }
  links.unshift(data);
  document.getElementById('linkTitle').value = '';
  document.getElementById('linkUrl').value = '';
  renderLinks();
}
document.getElementById('addLinkBtn').addEventListener('click', addLink);
document.getElementById('linkList').addEventListener('click', async e => {
  if (!e.target.dataset.delLink) return;
  if (!supabase) return;
  const { error } = await supabase.from('panel_links').delete().eq('id', e.target.dataset.delLink);
  if (error) { alert('删除失败：' + error.message); return; }
  links = links.filter(l => String(l.id) !== e.target.dataset.delLink);
  renderLinks();
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

// ---------- 启动 ----------
renderDate();
renderTimer();
renderTasks();
renderLinks();
loadTasks();
loadNotes();
loadLinks();
