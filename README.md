# XZCrawler

先知社区（xz.aliyun.com）文章爬虫与 Markdown 转换工具。

- 采用Playwright作为基础爬虫框架，可以有效绕过最新版先知社区的反爬机制。
- 因为最新版先知社区现在文章采用ne-viewer作为文章渲染工具，针对该html标签自定义一套markdown转换。
- 图片本地化：图片本地化与文章爬取不统一进行，使用 `npm run images-only` 进行图片本地化。

## 目录
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [参数与用法](#参数与用法)
- [配置文件](#配置文件)
- [输出说明](#输出说明)
- [合规说明](#合规说明)
- [许可证](#许可证)

## 环境要求
- Node.js 16+（建议 18+）

## 安装
```bash
npm install
npm run install-browsers
```

## 快速开始
- 默认启动（使用 `config.json` 或默认值）：
```bash
npm start
```
- 仅本地化 `papers/*.md` 中的远程图片（不爬取）：
```bash
npm run images-only
```
- 指定时间范围抓取 Q3 2025，最多翻 10 页：
```bash
npm run range-2025Q3
```
- 指定时间日期为2024年以后的文章：
```bash
npm run after-2024
```

## 参数与用法
三种来源的优先级：CLI > 环境变量 > `config.json`。

- CLI 参数
  - `--start-date=YYYY-MM-DD`：起始日期（含）
  - `--end-date=YYYY-MM-DD`：结束日期（含）
  - `--target-date=YYYY-MM-DD`：单一阈值（表示“此日期之后”），仅当未提供 start/end 时生效
  - `--max-pages=10`：最大翻页数
  - `--images-only`：图片本地化模式，不进行浏览器爬取
  - `--image`：抓取完成后自动对 `papers/*.md` 中的图片进行本地化
  - `--concurrency=3`：详情页抓取并发数（别名：`--conc` / `--parallel`），建议 3~6 之间

示例：
```bash
node xianzhi_crawler.js --start-date=2025-07-01 --end-date=2025-09-30 --max-pages=10
node xianzhi_crawler.js --target-date=2024-01-01 --max-pages=5
node xianzhi_crawler.js --images-only
node xianzhi_crawler.js --target-date=2024-01-01 --max-pages=8 --concurrency=5
```

- 环境变量（在 CLI 未提供时生效，接受多种大小写/风格）
  - `START_DATE` / `startDate`
  - `END_DATE` / `endDate`
  - `TARGET_DATE` / `targetDate`
  - `MAX_PAGES` / `maxPages`
  - `IMAGES_ONLY` / `imagesOnly`（`true`/`false`）
  - `IMAGE` / `image`（`true`/`false`）
  - `CONCURRENCY` / `concurrency` / `conc` / `parallel`

示例：
```bash
export START_DATE=2025-07-01
export END_DATE=2025-09-30
export MAX_PAGES=8
node xianzhi_crawler.js
```

## 配置文件
项目根目录可选的 `config.json`（优先级最低）：
```json
{
  "startDate": null,
  "endDate": null,
  "targetDate": null,
  "maxPages": 1,
  "imagesOnly": false,
  "image": true,
  "fetchFullContent": true,
  "concurrency": 3
}
```

## 输出说明
- 单篇文章文件：`papers/<标题>.md`
- 图片目录：`papers/images/`
- 索引汇总：`SUMMARY-<timestamp>.md`
- 实时索引汇总：`SUMMARY-REALTIME.md`

**示例目录结构：**

```
XZCrawler/
├─ papers/
│  ├─ 某数据泄露防护系统审计.md
│  ├─ 记一次对某OA的代码审计.md
│  └─ images/
│     └─ xxx.png
├─ SUMMARY-REALTIME.md
├─ SUMMARY-2025-09-30T12-00-00.md
└─ xianzhi_crawler.js
```

**SUMMARY 链接示例：**

```markdown
| 1 | [某数据泄露防护系统审计](papers/某数据泄露防护系统审计.md) | 安全研究 | 张三 | 2025-09-29 |
```

> 注：索引会统计分类、日期分布以及列出最新文章。


## 合规声明
本工具仅用于学习与研究，请遵守目标网站的服务条款与当地法律法规。

## 许可证
MIT
