# 工作面板 v2 — Vercel + Supabase 部署包

按用户每天的实际工作做的业务面板，不只是待办清单。顶部显示当天日期和
4 个业务统计（待跟进询盘 / 待处理订单 / 待发货 / SEO 待发布）+ 待办统计。
数据保存在 Supabase，换设备打开也会同步，不只存在浏览器本地。

## v2 相对 v1 的变化

- **修复“加载中”卡死**：v1 依赖外部 `@supabase/supabase-js` CDN，CDN 一卡
  页面就永远停在“加载中”。v2 不依赖任何外部 JS 库，直接用 `fetch()`
  调 Supabase REST API（`https://gplkvdodbfzknyafdttb.supabase.co/rest/v1/<表>`，
  带 `apikey` + `Authorization: Bearer <anon key>`），每次请求 10 秒超时，
  失败会在对应列表里显示错误 + 重试按钮，不会无限挂起。
- **新增 5 个业务模块**（标签页切换），每个模块都支持新增 / 编辑 / 删除 /
  状态修改、搜索、筛选和导出 CSV（带 UTF-8 BOM，Excel 打开中文不乱码）：
  - 💬 **询盘** `panel_inquiries`：客人/公司、产品、数量、报价状态
    （待报价/已报价/跟进中/已成交/已丢单）、跟进记录、日期
  - 🏭 **供应商** `panel_suppliers`：供应商名、产品、价格、起订量 MOQ、联系人、联系方式
  - 🔍 **SEO 进度** `panel_seo`：关键词、当前排名、目标排名、文章/页面、
    进度状态（待写/写作中/已发布/已收录）、更新日期
  - 🧾 **订单 / PI** `panel_orders`：订单号、客人、供应商、产品、金额、货币
    （USD/CNY/EUR）、PI 号、付款状态（未付/定金/已付清）、生产进度
    （待生产/生产中/已完成）
  - 📦 **发货** `panel_shipments`：客人、订单号、快递公司、快递单号、发货日期、
    状态（已发货/运输中/已签收）、备注
- **备份 / 导出**（🛠 工具页）：备份全部数据导出 JSON、导入 JSON 备份
  （按表逐条新增，不覆盖、不删除已有数据）、一键导出全部模块 CSV。
- **保留 v1 功能**：待办（新增/编辑/删除、高/中/低优先级、截止日期、打勾完成、
  筛选、点 ★ 置顶到「今日重点」）、25/15/5 分钟番茄钟、速记、常用链接。

## 文件

| 文件 | 说明 |
|---|---|
| `index.html` | 页面结构 + 标签页，引用 style.css、app.js（无外部 JS 库） |
| `app.js` | 全部交互逻辑 + Supabase REST（fetch）读写 |
| `style.css` | 样式，手机/电脑自适应 |
| `vercel.json` | 纯静态部署，无构建步骤 |
| `supabase.sql` | 建表 + RLS 策略 SQL（v1 三张表原样保留，新增五张表） |
| `README.md` | 本文件 |

## 1. 在 Supabase 建表（v2 新增部分）

打开 Supabase 控制台 → 项目 `neoprene-order-assistant`
（https://gplkvdodbfzknyafdttb.supabase.co）→ 左侧 SQL Editor，
粘贴 `supabase.sql` 的全部内容并执行。v1 的三张表（`panel_tasks` /
`panel_notes` / `panel_links`）原样保留，新增五张表：

- `panel_inquiries`、`panel_suppliers`、`panel_seo`、`panel_orders`、`panel_shipments`
  （id 为 uuid，`gen_random_uuid()`，其余字段见 supabase.sql）

本包的 RLS 策略允许 `anon` 角色读写这些表，适合单人自用。
如需登录鉴权，请把策略改为只允许 `authenticated`，并接 Supabase Auth。
**注意：** 必须先执行这一步建好新表，否则新模块会报加载失败
（页面会显示具体错误，不会再卡“加载中”）。

## 2. Supabase 配置

`app.js` 顶部已填好本项目的配置，不要改动：

```js
const SUPABASE_URL = 'https://gplkvdodbfzknyafdttb.supabase.co';
const SUPABASE_ANON_KEY = '<已填好的 anon public key>';
```

不要填 `service_role` key，那个不能放前端。

## 3. 部署到 Vercel（更新已部署的项目）

已部署的项目是 `work-panel`，生产地址
`https://work-panel-rouge.vercel.app`（`work-panel.vercel.app` 已被别人占用）。
更新办法：把本目录的改动推到 GitHub 仓库 `kevin-neoprene/work-panel`
的 main 分支，Vercel 会自动重新部署，网址不变。

```bash
cd work-panel-deploy
git add -A && git commit -m "v2: 询盘/供应商/SEO/订单/发货模块，fetch 直调 Supabase，修复加载卡死"
git push origin main
```

## 4. 验证

1. 先在 Supabase SQL Editor 执行 `supabase.sql`，确认 8 张表都在。
2. 打开部署好的网址，切换到「询盘」等标签页，各加一条记录，
   再导出一次 CSV，确认能下载、Excel 打开中文正常。
3. 换一个浏览器/手机再打开同一网址，应能看到刚才添加的内容。
4. 在 Supabase 控制台 → Table Editor 里查看各表，应能看到对应的行。

## 本地预览

```bash
cd work-panel-deploy
python3 -m http.server 8000
# 打开 http://localhost:8000
```
