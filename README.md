# 工作面板 — Vercel + Supabase 部署包

单页工作面板：顶部显示当天日期和统计（全部待办 / 已完成 / 今日重点 / 完成率），
待办支持新增、编辑、删除、高/中/低优先级、截止日期、打勾完成、全部/未完成/已完成筛选、
点 ★ 置顶到「今日重点」；右侧有 25/15/5 分钟番茄钟、速记、常用链接（新增/删除）。
数据保存在 Supabase，换设备打开也会同步，不只存在浏览器本地。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 页面结构，引用 Supabase JS v2 CDN、style.css、app.js |
| `app.js` | 全部交互逻辑 + Supabase 读写 |
| `style.css` | 样式，手机/电脑自适应 |
| `vercel.json` | 纯静态部署，无构建步骤 |
| `supabase.sql` | 建表 + RLS 策略 SQL |
| `README.md` | 本文件 |

## 1. 在 Supabase 建表

打开 Supabase 控制台 → 项目 `neoprene-order-assistant`
（https://gplkvdodbfzknyafdttb.supabase.co）→ 左侧 SQL Editor，
粘贴 `supabase.sql` 的全部内容并执行。会创建三张表：

- `panel_tasks`（id, title, done, starred, priority, due_date, created_at）
- `panel_notes`（id, content, created_at, updated_at）
- `panel_links`（id, title, url, created_at）

本包的 RLS 策略允许 `anon` 角色读写这三张表，适合单人自用。
如需登录鉴权，请把策略改为只允许 `authenticated`，并接 Supabase Auth。

## 2. 填入 Supabase anon key（必须手动做的一步）

`app.js` 顶部有两行配置：

```js
const SUPABASE_URL = 'https://gplkvdodbfzknyafdttb.supabase.co';
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__';
```

把 `__SUPABASE_ANON_KEY__` 换成真实 key。获取位置：
Supabase 控制台 → 项目设置（Settings → API）→ `anon public` key。
不要填 `service_role` key，那个不能放前端。

也可以不改代码，改用 Vercel 环境变量：部署时在 Vercel 项目设置里
加环境变量 `SUPABASE_ANON_KEY`，并在部署前用它替换该占位符
（本静态包不含构建步骤，所以最简单可靠的办法还是直接改 `app.js` 里的占位符）。

**注意：** 本包里没有填真实 key，占位符原样保留。没填 key 之前打开页面，
顶部会提示未配置，待办/速记/链接无法保存到云端。

## 3. 部署到 Vercel

方法 A（推荐，GitHub 导入）：
1. 把本目录推到一个新的 GitHub 仓库（例如 `work-panel`）。
2. 打开 Vercel 控制台 → Add New → Project → Import 这个仓库。
3. Framework Preset 选 `Other`，不需要 Build Command，也不需要 Output Directory
   改动，`vercel.json` 已声明纯静态。
4. Deploy。完成后会得到一个 `https://<项目名>.vercel.app` 网址，
   在任何设备、任何浏览器打开都是同一个面板。

方法 B（不用 GitHub）：
在 Vercel 控制台用 `vercel deploy` 或拖拽上传本目录（需先把 key 填好），
同样会得到一个 `.vercel.app` 网址。

## 4. 验证

1. 打开部署好的网址，添加一条待办、一条速记、一个链接。
2. 换一个浏览器/手机再打开同一网址，应能看到刚才添加的内容。
3. 在 Supabase 控制台 → Table Editor 里查看 `panel_tasks` / `panel_notes` /
   `panel_links`，应能看到对应的行。

## 本地预览

```bash
cd work-panel-deploy
python3 -m http.server 8000
# 打开 http://localhost:8000
```

直接双击 `index.html` 打开也能看页面，但 Supabase CDN 需联网，
且未填 key 时数据不会保存。
