# XZCrawler

先知社区（xz.aliyun.com）文章爬虫与 Markdown 转换工具。

- 自动点击“社区板块”后再开始爬取，确保抓取的是社区文章列表
- 提取文章标题、作者、分类、发布时间及正文
- 强化的 Markdown 转换：
  - ne-viewer 自定义节点适配（段落/标题/列表/表格/卡片等）
  - 代码块精准提取（CodeMirror 行拼接、语言识别，绝不逐行包裹 ```）
  - 内联代码反引号安全包裹（自动扩展反引号长度）
  - 文本尖括号转义，避免被 Markdown 当作 HTML 标签
- 图片本地化：
  - 抓取时识别懒加载属性并解析相对路径
  - 可遍历现有 `papers/*.md`，带 Referer 下载远端图片并重写为本地相对路径（images-only 模式）
- 可配置的时间过滤：支持开始/结束日期或单一阈值日期
- 参数化：CLI > ENV > `config.json`，三种方式可选
- 产物：
  - 每篇文章一个 Markdown 文件，保存在 `papers/`
  - 自动生成索引汇总 `SUMMARY-<timestamp>.md`

## 目录
- [环境要求](#环境要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [参数与用法](#参数与用法)
- [配置文件](#配置文件)
- [输出说明](#输出说明)
- [常见问题](#常见问题)

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
- 指定阈值日期（老参数兼容方式）：
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
  - `--images-only`：只进行图片本地化，不进行浏览器爬取

示例：
```bash
node xianzhi_crawler.js --start-date=2025-07-01 --end-date=2025-09-30 --max-pages=10
node xianzhi_crawler.js --target-date=2024-01-01 --max-pages=5
node xianzhi_crawler.js --images-only
```

- 环境变量（在 CLI 未提供时生效，接受多种大小写/风格）
  - `START_DATE` / `startDate`
  - `END_DATE` / `endDate`
  - `TARGET_DATE` / `targetDate`
  - `MAX_PAGES` / `maxPages`
  - `IMAGES_ONLY` / `imagesOnly`（`true`/`false`）

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
  "fetchFullContent": true
}
```

## 输出说明
- 单篇文章文件：`papers/<标题处理>.md`
- 图片目录：`papers/images/`
- 索引汇总：`SUMMARY-<timestamp>.md`

> 注：索引会统计分类、日期分布以及列出最新文章。

## 许可证
MIT
