# 金句背景图静态托管 · 待办（CDN/静态文件未就绪）

> 日期：2026-10-22 · 状态：**未解决（后端待办）**，前端已做本地兜底，不白屏不报错
> 关联：`../archive/progress-2026-10/home-quote-backend-2026-10-22.md` §五 / `xin_su_app/docs/archive/2026-10/home-quote-backend-api-2026-10-22.md`（均已归档追溯）

## 1. 问题

金句接口下发 `backgroundUrl`，当前 env `QUOTE_CDN_BASE_URL` 缺省为
`https://cdn.xinsu.app/quote/`，例如：

```
https://cdn.xinsu.app/quote/quote_dawn_lake.jpg
https://cdn.xinsu.app/quote/quote_starry_mountain.jpg
```

但**该静态域名/对象存储目前不存在**，浏览器请求直接 404。在静态托管就绪前，
沉浸页与首页圆形缩略图拿不到远端图。

前端现状（已处理，不阻塞）：
- `Image.network` 失败 → `errorBuilder` 回退本地 asset 图，且兜底图带固定尺寸，不会再溢出。
- 文本/收藏/分页全部正常，仅背景显示本地图。

## 2. 后端需要补的三选一

### 方案 A（推荐）：对象存储/CDN
- 开通 CDN 或 OSS（如阿里云 OSS + CDN / 腾讯云 COS），建 `quote/` 目录。
- 把金句背景竖版图上传到 `quote/`，文件名与 seed 一致。
- `QUOTE_CDN_BASE_URL` 指向该公开可读前缀，重跑 `npm run seed:quotes` 刷新 `background_url`。
- 图片走长期缓存（CDN cache-control），竖版、上中部留暗部便于压白字。

### 方案 B：Nest 本地静态目录
- 用 `@nestjs/serve-static` 或 Express `express.static` 暴露一个静态目录（如 `public/quote/`）。
- `QUOTE_CDN_BASE_URL` 指向同源 `/static/quote/`；仅适合开发/小规模，生产仍建议 OSS/CDN。

### 方案 C：过渡期先不下发远端地址
- CDN 就绪前，`backgroundUrl` 返回空串，前端统一用本地图；上线 CDN 后再下发完整 URL。
- 不需要改前端判断逻辑（空串/404 都走兜底）。

## 3. 验收

1. `GET /counselor/quotes/today` 的 `backgroundUrl` 在浏览器直接打开 200，图可访问。
2. 首页圆形缩略图、沉浸页满版背景都显示远端图，无 404、无本地兜底闪烁。
3. 换图只改 seed 文件 + 重跑 seed，不改前端。
4. 响应头带缓存；不暴露 Bucket 私有路径。

## 4. 非目标

- 不在金句 DTO 里加图片宽度/高度/缩略图字段（本期固定竖版满版，无需）。
- 不做用户上传背景图（产品原创内容库由运营维护）。
