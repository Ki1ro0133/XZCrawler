const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

class XianzhiCrawler {
    constructor(options = {}) {
        this.baseUrl = 'https://xz.aliyun.com/news';
        // 过滤时间：支持 startDate/endDate 或单一 targetDate（向后兼容）
        this.startDate = options.startDate ? new Date(options.startDate) : null;
        this.endDate = options.endDate ? new Date(options.endDate) : null;
        this.targetDate = options.targetDate ? new Date(options.targetDate) : (this.startDate || null);
        this.articles = [];
        this.browser = null;
        this.page = null;
        this.fetchFullContent = options.fetchFullContent !== false; // 是否获取完整文章内容，默认为true
        this.maxPages = options.maxPages || 1; // 最大爬取页数
        this.debugSaved = false; // 调试标志
        this.imagesOnly = !!options.imagesOnly; // 仅进行本地图片下载
    }

    async init() {
        console.log('启动浏览器...');
        this.browser = await chromium.launch({ 
            headless: true, // 设为false可以看到浏览器操作过程
        });
        
        const context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        
        this.page = await context.newPage();
    }

    async navigateToNews() {
        console.log('访问先知社区新闻页面...');
        try {
            await this.page.goto(this.baseUrl, { 
                referer: "https://xz.aliyun.com/",
                waitUntil: 'domcontentloaded'
            });
            
            console.log('页面加载完成');
            
            // 点击社区板块标签
            try {
                const communityTab = this.page.locator('text=社区板块').first();
                if (await communityTab.isVisible({ timeout: 5000 })) {
                    console.log('找到社区板块标签，点击切换...');
                    await communityTab.click();
                    // 等待社区板块标签被选中
                    await this.page.waitForLoadState("networkidle");
                    console.log('已切换到社区板块');
                } else {
                    console.log('未找到社区板块标签，可能已经在社区板块页面');
                }
            } catch (error) {
                console.log('点击社区板块标签失败:', error.message);
            }
            
        } catch (error) {
            throw new Error(`导航到新闻页面失败: ${error.message}`);
        }
    }

    async scrapeArticles() {
        console.log('开始爬取文章...');
        
        let hasMorePages = true;
        let currentPage = 1;
        let totalArticles = 0;
        
        while (hasMorePages && currentPage <= this.maxPages) {
            console.log(`\n=== 爬取第 ${currentPage} 页 ===`);
            
            // 等待新闻列表加载
            await this.page.waitForSelector('#news_list .news_item', { timeout: 10000 });

            await this.page.waitForTimeout(3000); // 等待三秒钟
            
            // 获取当前页面的文章
            const articlesOnPage = await this.extractArticlesFromPage();
            
            if (articlesOnPage.length === 0) {
                console.log('当前页面没有找到文章，停止爬取');
                break;
            }

            // 筛选文章（支持时间范围）
            const filteredArticles = articlesOnPage.filter(article => {
                if (!article.publishTime) return false;
                try {
                    const articleDate = new Date(article.publishTime);
                    let include = true;
                    if (this.startDate) include = include && (articleDate >= this.startDate);
                    if (this.endDate) include = include && (articleDate <= this.endDate);
                    if (!this.startDate && !this.endDate && this.targetDate) {
                        // 仅提供了单一阈值日期（向后兼容旧逻辑）
                        include = include && (articleDate > this.targetDate);
                    }
                    return include;
                } catch (error) {
                    console.log(`解析时间失败: ${article.publishTime}`);
                    return false;
                }
            });
            
            // 如果需要获取完整内容，则访问每篇文章页面
            if (this.fetchFullContent) {
                for (let i = 0; i < filteredArticles.length; i++) {
                    try {
                        console.log(`获取第 ${i + 1}/${filteredArticles.length} 篇文章的完整内容...`);
                        const articleData = await this.fetchArticleContent(filteredArticles[i].link);
                        filteredArticles[i].content = articleData.content;
                        // 如果页面标题更准确，更新标题
                        if (articleData.title && articleData.title !== '未知标题' && articleData.title !== '访问失败') {
                            filteredArticles[i].title = articleData.title;
                        }
                        await this.page.waitForTimeout(1500); // 避免请求过快
                    } catch (error) {
                        console.log(`获取文章内容失败: ${error.message}`);
                        filteredArticles[i].content = '获取内容失败: ' + error.message;
                    }
                }
            }
            
            this.articles.push(...filteredArticles);
            totalArticles += articlesOnPage.length;
            
            console.log(`第 ${currentPage} 页: 找到 ${articlesOnPage.length} 篇文章，符合条件 ${filteredArticles.length} 篇`);
            console.log(`累计: 总文章 ${totalArticles} 篇，符合条件 ${this.articles.length} 篇`);
            
            // 显示最新3篇文章信息
            if (filteredArticles.length > 0) {
                console.log('本页符合条件的文章:');
                filteredArticles.slice(0, 3).forEach((article, index) => {
                    console.log(`  ${index + 1}. ${article.title.substring(0, 60)}... (${article.publishTime})`);
                });
            }

            // 检查是否有更旧的文章（如果有文章早于起始日期/阈值，说明后续页面文章会更旧）
            const thresholdDate = this.startDate || this.targetDate || null;
            const hasOlderArticles = thresholdDate ? articlesOnPage.some(article => {
                if (!article.publishTime) return false;
                try {
                    const articleDate = new Date(article.publishTime);
                    return articleDate <= thresholdDate;
                } catch (error) {
                    return false;
                }
            }) : false;
            
            if (hasOlderArticles && currentPage > 3) {
                console.log('发现有文章早于目标日期，且已爬取足够页面，停止爬取');
                break;
            }
            
            // 尝试翻页
            hasMorePages = await this.goToNextPage();
            if (hasMorePages) {
                currentPage++;
            }
        }
        
        console.log(`\n爬取完成！共获取 ${this.articles.length} 篇文章`);
    }

    async fetchArticleContent(articleUrl) {
        try {
            // 在新标签页中打开文章
            const articlePage = await this.browser.newPage();
            await articlePage.goto(articleUrl, { waitUntil: 'load', timeout: 300000, referer: "https://xz.aliyun.com/" });
            
            // 提取文章标题
            let title = '';
            try {
                const titleSelectors = [
                    'h1',
                    '.article-title',
                    '.entry-title',
                    '[class*="title"]:first-child',
                    'title'
                ];
                
                for (const selector of titleSelectors) {
                    const titleElement = articlePage.locator(selector).first();
                    if (await titleElement.isVisible({ timeout: 2000 })) {
                        const titleText = await titleElement.textContent();
                        if (titleText && titleText.length > 5) {
                            title = titleText;
                            break;
                        }
                    }
                }
                
                // 从页面标题中提取（作为备选）
                if (!title) {
                    const pageTitle = await articlePage.title();
                    if (pageTitle && pageTitle.includes('-先知社区')) {
                        title = pageTitle.replace('-先知社区', '');
                    }
                }
            } catch (error) {
                console.log('提取文章标题失败:', error.message);
            }
            
            // 提取文章内容 - 获取HTML并转换为Markdown
            let content = '';
            try {
                // 优先使用 ne-viewer-body 获取HTML内容
                const contentElement = articlePage.locator('.ne-viewer-body').first();

                const htmlContent = await contentElement.innerHTML();

                // 将html内容保存至本地以供调试
                // fs.writeFileSync(path.join(__dirname, 'debug_article.html'), htmlContent, 'utf8');

                if (htmlContent && htmlContent.length > 100) {
                    console.log('成功获取 ne-viewer-body HTML内容');
                    content = this.convertHtmlToMarkdown(htmlContent);
                }
                
                if (!content) {
                    content = '无法获取文章内容';
                }
                
            } catch (error) {
                content = '提取文章内容失败: ' + error.message;
            }
            
            await articlePage.close();
            return {
                title: title.trim() || '未知标题',
                content: content.trim() || '无法获取文章内容'
            };
            
        } catch (error) {
            console.log(`访问文章页面失败: ${error.message}`);
            return {
                title: '访问失败',
                content: '访问文章页面失败: ' + error.message
            };
        }
    }

    async extractArticlesFromPage() {
        console.log('提取当前页面的文章...');
        
        // 尝试多个选择器以适应不同页面结构
        const articleSelectors = [
            '.news_item',  // 主要选择器：class="news_item"
            'div[class*="news_item"]', // 备用选择器
        ];
        
        let articles = [];
        
        for (const selector of articleSelectors) {
            try {
                const elements = await this.page.locator(selector).all();
                if (elements.length > 0) {
                    console.log(`使用选择器 ${selector} 找到 ${elements.length} 个文章元素`);
                    
                    for (let i = 0; i < elements.length; i++) {
                        try {
                            const article = await this.extractArticleInfo(elements[i]);
                            if (article && article.title) {
                                articles.push(article);
                            }
                        } catch (error) {
                            console.log(`提取第 ${i + 1} 个文章时出错: ${error.message}`);
                        }
                    }
                    
                    if (articles.length > 0) {
                        break; // 找到文章就不再尝试其他选择器
                    }
                }
            } catch (error) {
                console.log(`选择器 ${selector} 查找失败: ${error.message}`);
                continue;
            }
        }
        
        return articles;
    }

    async extractArticleInfo(element) {
        try {
            // 提取标题
            let title = '';
            try {
                const newsLinks = await element.locator('a[href*="/news/"]').all();
                
                if (newsLinks.length >= 2) {
                    // 使用第二个链接（通常是文章标题）
                    title = await newsLinks[1].textContent();
                    title = title ? title : '';
                } else if (newsLinks.length >= 1) {
                    // 如果只有一个链接，使用第一个
                    title = await newsLinks[0].textContent();
                    title = title ? title : '';
                }
            } catch (error) {
                console.log('提取标题失败:', error.message);
            }
            
            // 提取链接
            let link = '';
            try {
                const newsLinks = await element.locator('a[href*="/news/"]').all();
                
                if (newsLinks.length >= 2) {
                    const href = await newsLinks[1].getAttribute('href');
                    if (href) {
                        link = href.startsWith('http') ? href : new URL(href, this.baseUrl).href;
                    }
                } else if (newsLinks.length >= 1) {
                    const href = await newsLinks[0].getAttribute('href');
                    if (href) {
                        link = href.startsWith('http') ? href : new URL(href, this.baseUrl).href;
                    }
                }
            } catch (error) {
                console.log('提取链接失败:', error.message);
            }
            
            // 提取发布时间
            let publishTime = '';
            try {
                const fullText = await element.textContent();
                // 匹配"· 174浏览 · 2025-09-26 08:49"格式
                const timePattern = /·\s*\d+浏览\s*·\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/;
                const match = fullText.match(timePattern);
                
                if (match) {
                    publishTime = match[1];
                } else {
                    // 备用时间格式
                    const simpleTimePattern = /(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/;
                    const simpleMatch = fullText.match(simpleTimePattern);
                    if (simpleMatch) {
                        publishTime = simpleMatch[1];
                    }
                }
                publishTime = publishTime.trim();
            } catch (error) {
                console.log('提取时间失败:', error.message);
            }
            
            // 提取分类
            let category = '';
            try {
                const categoryLink = element.locator('a[href*="cate_id="]').first();
                if (await categoryLink.isVisible({ timeout: 1000 })) {
                    category = await categoryLink.textContent();
                    category = category ? category : '';
                }
            } catch (error) {
                console.log('提取分类失败:', error.message);
            }
            
            // 提取作者信息
            let author = '';
            try {
                const authorLink = element.locator('a[href*="/users/"]').first();
                if (await authorLink.isVisible({ timeout: 1000 })) {
                    const authorText = await authorLink.textContent();
                    if (authorText) {
                        // 提取用户名（去除"发表于 地区"部分）
                        const lines = authorText.split('\n').filter(line => line);
                        author = lines[0];
                    }
                }
            } catch (error) {
                console.log('提取作者失败:', error.message);
            }
            
            // 提取摘要
            let summary = '';
            try {
                const paragraphs = await element.locator('p').all();
                for (const p of paragraphs) {
                    try {
                        const pText = await p.textContent();
                        if (pText && pText && pText.length > 20 && 
                            pText !== title && !pText.includes('浏览')) {
                            summary = pText.substring(0, 200);
                            break;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            } catch (error) {
                console.log('提取摘要失败:', error.message);
            }
            
            if (title && title.length > 5) {
                return {
                    title,
                    link,
                    publishTime,
                    category,
                    author,
                    summary,
                    extractedAt: new Date().toISOString()
                };
            }
            
            return null;
        } catch (error) {
            console.log('提取文章信息时出错:', error.message);
            return null;
        }
    }

    async goToNextPage() {
        try {
            // 查找"下一页"链接
            const nextPageLink = this.page.locator('a:has-text("下一页")').first();
            
            if (await nextPageLink.isVisible({ timeout: 3000 })) {
                console.log('找到下一页链接，正在翻页...');
                await nextPageLink.click();
                await this.page.waitForLoadState("networkidle");
                return true;
            } else {
                console.log('没有找到下一页链接，已到最后一页');
                return false;
            }
        } catch (error) {
            console.log('翻页失败:', error.message);
            return false;
        }
    }

    async saveResults() {
        if (this.articles.length === 0) {
            console.log('没有文章需要保存');
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // 创建papers文件夹
        const papersDir = path.join(__dirname, 'papers');
        if (!fs.existsSync(papersDir)) {
            fs.mkdirSync(papersDir, { recursive: true });
            console.log(`创建文件夹: ${papersDir}`);
        }
        
        // 为每篇文章创建单独的Markdown文件
        console.log(`开始保存 ${this.articles.length} 篇文章到papers文件夹...`);
        
        const savedFiles = [];
        
        for (let i = 0; i < this.articles.length; i++) {
            const article = this.articles[i];
            try {
                const fileName = this.generateFileName(article, i + 1);
                const filePath = path.join(papersDir, fileName);
                const articleMarkdown = this.generateSingleArticleMarkdown(article);
                
                fs.writeFileSync(filePath, articleMarkdown, 'utf8');
                savedFiles.push(fileName);
                
                if ((i + 1) % 10 === 0 || i === this.articles.length - 1) {
                    console.log(`已保存 ${i + 1}/${this.articles.length} 篇文章`);
                }
            } catch (error) {
                console.error(`保存文章 "${article.title}" 失败:`, error.message);
            }
        }
        
        // 创建索引文件
        const indexPath = path.join(__dirname, 'SUMMARY-' + timestamp + '.md');
        const indexContent = this.generateIndexMarkdown(savedFiles);
        fs.writeFileSync(indexPath, indexContent, 'utf8');
        
        console.log(`\n✅ 完成！已保存 ${savedFiles.length} 篇文章到papers文件夹`);
        console.log(`📋 索引文件: ${indexPath}`);
        
        // 生成统计报告
        this.generateReport();
    }

    generateFileName(article, index) {
        // 生成安全的文件名，只使用标题
        let fileName = article.title
            .replace(/[<>:"/\\|?*]/g, '') // 移除不安全字符
            .replace(/[\s()（）\[\]【】]/g, '_') // 空格和括号替换为下划线
            .replace(/_+/g, '_') // 多个下划线合并为一个
            .replace(/^_|_$/g, '') // 移除开头和结尾的下划线
            .substring(0, 80); // 限制长度
        
        // 确保文件名不为空
        if (!fileName) {
            fileName = `article_${index}`;
        }
        
        return `${fileName}.md`;
    }

    generateSingleArticleMarkdown(article) {
        let markdown = `# ${article.title}\n\n`;
        
        // 文章完整内容
        if (article.content && article.content) {
            
            // 更好的内容格式化
            let formattedContent = article.content;
        
            // 直接使用转换后的内容，避免对每行再包裹 ``` 造成代码块破碎
            markdown += formattedContent + '\n\n';
        } else {
            markdown += `## 📖 文章内容\n\n`;
            markdown += `> 暂无完整内容，请点击原文链接查看。\n\n`;
        }
        
        // 添加页脚
        markdown += `---\n\n`;
        markdown += `> 本文档由先知社区爬虫自动生成  \n`;
        markdown += `> 原文链接: ${article.link}  \n`;
        markdown += `> 爬取时间: ${new Date(article.extractedAt).toLocaleString('zh-CN')}  \n`;
        
        // 折叠连续多个“空行”（空行可包含空白符和不可见字符，如零宽空格、NBSP、BOM 等）为一个空行，且跳过代码块
        const parts = markdown.split(/(```[\s\S]*?```)/g);
        const blankLikeRun = /(?:^[\s\u00A0\u3000\u200B\u200C\u200D\u200E\u200F\u2060\uFEFF]*\r?\n){2,}/gm;
        const normalizedMarkdown = parts
            .map(p => p.startsWith('```')
            ? p
            : p
                .replace(/\r\n?/g, '\n')      // 统一换行
                .replace(blankLikeRun, '\n\n') // 折叠“空行”
            )
            .join('');
        return normalizedMarkdown;
    }

    generateIndexMarkdown(savedFiles) {
        // 按发布时间倒序排列
        const sortedArticles = this.articles.sort((a, b) => 
            new Date(b.publishTime) - new Date(a.publishTime)
        );

        let markdown = `# 先知社区文章合集\n\n`;
        markdown += `> 🕒 爬取时间: ${new Date().toLocaleString('zh-CN')}\n`;
        markdown += `> 📊 文章数量: ${this.articles.length} 篇\n`;
        const rangeDesc = (() => {
            if (this.startDate && this.endDate) return `${this.startDate.toISOString().slice(0,10)} 至 ${this.endDate.toISOString().slice(0,10)}`;
            if (this.startDate) return `${this.startDate.toISOString().slice(0,10)} 之后`;
            if (this.endDate) return `截至 ${this.endDate.toISOString().slice(0,10)}`;
            if (this.targetDate) return `${this.targetDate.toISOString().slice(0,10)} 之后`;
            return `未限制`;
        })();
        markdown += `> 📅 时间范围: ${rangeDesc}\n`;
        markdown += `> 🔗 来源: [先知社区](${this.baseUrl})\n\n`;

        // 生成分类统计
        const categoryStats = {};
        this.articles.forEach(article => {
            const cat = article.category || '未分类';
            categoryStats[cat] = (categoryStats[cat] || 0) + 1;
        });

        markdown += `## 📊 分类统计\n\n`;
        Object.entries(categoryStats)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, count]) => {
                markdown += `- **${category}**: ${count} 篇\n`;
            });
        markdown += `\n---\n\n`;

        // 生成文章目录
        markdown += `## 📚 文章列表\n\n`;
        markdown += `| 序号 | 标题 | 分类 | 作者 | 发布时间 | 文件 |\n`;
        markdown += `|------|------|------|------|----------|------|\n`;
        
        sortedArticles.forEach((article, index) => {
            const fileName = this.generateFileName(article, index + 1);
            const shortTitle = article.title.length > 50 ? 
                article.title.substring(0, 50) + '...' : article.title;
            
            markdown += `| ${index + 1} | [${shortTitle}](${fileName}) | ${article.category || '未分类'} | ${article.author || '未知'} | ${article.publishTime || '未知'} | [📄](${fileName}) |\n`;
        });
        
        markdown += `\n---\n\n`;
        markdown += `> 💡 提示: 点击标题或文件链接可以查看具体文章内容\n`;
        
        return markdown;
    }

    generateMarkdownContent() {
        // 按发布时间倒序排列
        const sortedArticles = this.articles.sort((a, b) => 
            new Date(b.publishTime) - new Date(a.publishTime)
        );

        let markdown = `# 先知社区文章合集\n\n`;
        markdown += `> 🕒 爬取时间: ${new Date().toLocaleString('zh-CN')}\n`;
        markdown += `> 📊 文章数量: ${this.articles.length} 篇\n`;
        const rangeDesc = (() => {
            if (this.startDate && this.endDate) return `${this.startDate.toISOString().slice(0,10)} 至 ${this.endDate.toISOString().slice(0,10)}`;
            if (this.startDate) return `${this.startDate.toISOString().slice(0,10)} 之后`;
            if (this.endDate) return `截至 ${this.endDate.toISOString().slice(0,10)}`;
            if (this.targetDate) return `${this.targetDate.toISOString().slice(0,10)} 之后`;
            return `未限制`;
        })();
        markdown += `> 📅 时间范围: ${rangeDesc}\n`;
        markdown += `> 🔗 来源: [先知社区](${this.baseUrl})\n\n`;

        // 生成目录
        markdown += `## 📋 目录\n\n`;
        sortedArticles.forEach((article, index) => {
            const anchor = this.generateAnchor(article.title);
            markdown += `${index + 1}. [${article.title}](#${anchor})\n`;
        });
        markdown += `\n---\n\n`;

        // 生成分类统计
        const categoryStats = {};
        this.articles.forEach(article => {
            const cat = article.category || '未分类';
            categoryStats[cat] = (categoryStats[cat] || 0) + 1;
        });

        markdown += `## 📊 分类统计\n\n`;
        Object.entries(categoryStats)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, count]) => {
                markdown += `- **${category}**: ${count} 篇\n`;
            });
        markdown += `\n---\n\n`;

        // 生成文章内容
        markdown += `## 📚 文章列表\n\n`;
        
        sortedArticles.forEach((article, index) => {
            markdown += this.generateArticleMarkdown(article, index + 1);
        });

        return markdown;
    }

    generateAnchor(title) {
        // 生成URL友好的锚点
        return title
            .toLowerCase()
            .replace(/[^\w\u4e00-\u9fa5\s-]/g, '') // 保留中文、字母、数字、空格、连字符
            .replace(/\s+/g, '-') // 空格替换为连字符
            .replace(/-+/g, '-') // 多个连字符合并为一个
            ;
    }

    generateArticleMarkdown(article, index) {
        let markdown = `### ${index}. ${article.title}\n\n`;
        
        // 文章元信息表格
        markdown += `| 项目 | 内容 |\n`;
        markdown += `|------|------|\n`;
        markdown += `| 📅 发布时间 | ${article.publishTime || '未知'} |\n`;
        markdown += `| 🏷️ 分类 | ${article.category || '未分类'} |\n`;
        markdown += `| 👤 作者 | ${article.author || '未知'} |\n`;
        markdown += `| 🔗 原文链接 | [点击查看](${article.link}) |\n\n`;
        
        // 文章摘要
        if (article.summary && article.summary) {
            markdown += `**📄 摘要**:\n\n`;
            markdown += `> ${article.summary}\n\n`;
        }
        
        // 如果有完整内容，添加到markdown中
        if (article.content && article.content && this.fetchFullContent) {
            markdown += `**📖 完整内容**:\n\n`;
            // 将内容转换为合适的markdown格式
            const formattedContent = article.content
                .split('\n')
                .map(line => line)
                .filter(line => line.length > 0)
                .join('\n\n');
            markdown += `${formattedContent}\n\n`;
        }
        
        markdown += `---\n\n`;
        
        return markdown;
    }

    convertHtmlToMarkdown(html) {
        try {
            // 创建DOM实例进行解析
            const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
            const document = dom.window.document;
            const body = document.body;
            
            // 递归转换DOM节点为Markdown
            const markdown = this.convertDomNodeToMarkdown(body);
            
            // 标准化空白和换行
            return markdown
        } catch (error) {
            console.log('HTML解析失败，使用备用方法:', error.message);
            // 如果DOM解析失败，回退到简单的文本清理
            return this.cleanHtmlTags(html);
        }
    }

    convertDomNodeToMarkdown(node, context = {}) {
        if (!node) return '';
        
        // 文本节点
        if (node.nodeType === 3) { // TEXT_NODE
            return this.escapeMarkdown(node.textContent);
        }
        
        // 元素节点
        if (node.nodeType === 1) { // ELEMENT_NODE
            const tagName = node.tagName.toLowerCase();
            const attributes = this.getElementAttributes(node);

            // === 关键改动：对需要“原始HTML”的节点直接短路 ===
            if (tagName === 'ne-card' && attributes['data-card-name'] === 'codeblock') {
                // 直接用原始子树HTML提取代码块，避免递归后结构丢失
                return this.extractCodeFromCard(node.innerHTML, attributes);
            }
            if (tagName === 'ne-table' || tagName === 'table') {
                // 将原始HTML交给表格转换器
                return `\n${this.convertTableToMarkdown(node.innerHTML)}\n\n`;
            }
            if (tagName === 'ne-code') {
                // inline code: 使用原始文本内容，避免转义，再安全地用反引号包裹
                const raw = (node.textContent || '').replace(/\n+/g, ' ');
                const runs = raw.match(/`+/g);
                let fenceLen = 1;
                if (runs && runs.length) {
                    fenceLen = Math.max(...runs.map(s => s.length)) + 1;
                }
                const fence = '`'.repeat(fenceLen);
                const needsPadding = raw.startsWith('`') || raw.endsWith('`') || raw.startsWith(' ') || raw.endsWith(' ');
                return needsPadding ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
            }

            let content = '';
            
            // 为子节点创建新的上下文
            const childContext = { ...context };
            if (tagName === 'ne-ol' || tagName === 'ol') {
                childContext.parentListType = 'ordered';
                childContext.listIndex = 0;
            } else if (tagName === 'ne-ul' || tagName === 'ul') {
                childContext.parentListType = 'unordered';
            }
            
            // 递归处理子节点
            for (let child of node.childNodes) {
                if (child.nodeType === 1) {
                    const ctn = child.tagName.toLowerCase();
                    if (ctn === 'ne-li' || ctn === 'li' || ctn === 'ne-oli') {
                        if (childContext.parentListType === 'ordered') {
                            childContext.listIndex = (childContext.listIndex || 0) + 1;
                        }
                    }
                }
                content += this.convertDomNodeToMarkdown(child, childContext);
            }
            
            return this.convertElementToMarkdown(tagName, attributes, content, context);
        }
        
        return '';
    }

    getElementAttributes(element) {
        const attrs = {};
        for (let attr of element.attributes) {
            attrs[attr.name] = attr.value;
        }
        return attrs;
    }

    convertElementToMarkdown(tagName, attributes, content, context = {}) {
        switch (tagName) {
            // ne-viewer 自定义标签
            case 'ne-h1':
                return `\n# ${content}\n\n`;
            case 'ne-h2':
                return `\n## ${content}\n\n`;
            case 'ne-h3':
                return `\n### ${content}\n\n`;
            case 'ne-h4':
                return `\n#### ${content}\n\n`;
            case 'ne-h5':
                return `\n##### ${content}\n\n`;
            case 'ne-h6':
                return `\n###### ${content}\n\n`;
                
            case 'ne-p':
                // 移除填充器内容
                if (content) {
                    return `${content}\n\n`;
                }
                return '';
                
            case 'ne-hole':
                // ne-hole 是容器，直接返回内容
                return content;
            case 'ne-text':
                // 处理ne-text的样式属性
                let styledContent = content;
                if (attributes['ne-bold'] === 'true') {
                    styledContent = `**${styledContent}**`;
                }
                if (attributes['ne-italic'] === 'true') {
                    styledContent = `*${styledContent}*`;
                }
                if (attributes['ne-code'] === 'true') {
                    styledContent = `\`${styledContent}\``;
                }
                if (attributes['ne-underline'] === 'true') {
                    styledContent = `<u>${styledContent}</u>`;
                }
                if (attributes['ne-strikethrough'] === 'true') {
                    styledContent = `~~${styledContent}~~`;
                }
                return styledContent;
                
            case 'ne-code': {
                // ne-code 内联代码。content 可能已被转义，这里主要作为回退。
                const raw = content.replace(/\n+/g, ' ');
                const runs = raw.match(/`+/g);
                let fenceLen = 1;
                if (runs && runs.length) {
                    fenceLen = Math.max(...runs.map(s => s.length)) + 1;
                }
                const fence = '`'.repeat(fenceLen);
                const needsPadding = raw.startsWith('`') || raw.endsWith('`') || raw.startsWith(' ') || raw.endsWith(' ');
                return needsPadding ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
            }

            case 'ne-codeblock':
                // 在代码块上下文内，避免子元素再包裹内联反引号
                const language = attributes['language'] || '';
                // 标记上下文，防止子级 ne-code 处理
                if (context) context.inCodeBlock = true;
                const inner = content;
                if (context) context.inCodeBlock = false;
                return `\n\`\`\`${language}\n${inner}\n\`\`\`\n\n`;
                
            case 'ne-ul':
                return `\n${content}\n`;
                
            case 'ne-ol':
                return `\n${content}\n`;
                
            case 'ne-oli':
                // 独立的列表项（ne-oli），根据上下文判断是否有序
                if (context.parentListType === 'ordered') {
                    const index = context.listIndex || 1;
                    return `${index}. ${content}\n`;
                } else {
                    return `- ${content}\n`;
                }

            case 'ne-li':
                // 使用上下文信息判断列表类型
                if (context.parentListType === 'ordered') {
                    const index = context.listIndex || 1;
                    return `${index}. ${content}\n`;
                } else {
                    return `- ${content}\n`;
                }

            // 列表项内部结构
            case 'ne-oli-i':
                // 列表符号/编号（例如 •、1、a），保留下来并在后面追加空格
                return content ? `${content} ` : '';
            case 'ne-oli-c':
                // 列表内容容器
                return content;
            case 'ne-list-symbol':
                // 自定义符号不直接输出
                return '';
                
            case 'ne-card':
                // 检查卡片类型
                const cardType = attributes['data-card-type'];
                const cardName = attributes['data-card-name'];
                
                if (cardName === 'codeblock' || cardType === 'block') {
                    // 这是代码块卡片，提取实际代码内容
                    return this.extractCodeFromCard(content, attributes);
                } else if (content.includes('![')) {
                    // 图片卡片
                    return `\n${content}\n\n`;
                } else {
                    // 其他类型的卡片
                    return `\n> ${content}\n\n`;
                }
                
            case 'ne-table-hole':
            case 'ne-table-wrap':
            case 'ne-table-inner-wrap':
            case 'ne-table-box':
                // 这些是包装器，直接返回内容
                return content;
                
            case 'ne-table':
            case 'table':
                // 实际的表格元素，进行表格转换
                return `\n${this.convertTableToMarkdown(content)}\n\n`;
                
            case 'ne-table-row':
            case 'ne-tr':
            case 'tr':
                return content;
                
            case 'ne-table-cell':
            case 'ne-td':
            case 'td':
            case 'th':
                return content;
                
            case 'ne-td-content':
                return content;
                
            case 'ne-td-break':
                return ''; // 忽略单元格分隔符
                
            case 'colgroup':
            case 'col':
            case 'tbody':
            case 'thead':
            case 'tfoot':
                return content; // 表格结构元素，返回内容
                
            // 标准HTML标签 - 仅保留基本格式化标签
            case 'br':
                return '\n';
                
            case 'a':
                const href = attributes['href'] || '';
                return href ? `[${content}](${href})` : content;
                
            case 'img':
                const src = attributes['src'] || '';
                const alt = attributes['alt'] || '图片';
                return src ? `![${alt}](${src})` : '';
                
            // CodeMirror 相关元素
            case 'div':
            case 'span':
                const className = attributes['class'] || '';
                
                // 忽略填充器
                if (className.includes('ne-viewer-b-filler') || attributes['ne-filler']) {
                    return '';
                }
                
            // CodeMirror 代码行 - 保持原样不添加换行，让extractCodeFromCard处理
            if (className.includes('cm-line')) {
                return content;
            }                // 忽略 CodeMirror UI 组件
                if (className.includes('cm-editor') ||
                    className.includes('cm-scroller') ||
                    className.includes('cm-content') ||
                    className.includes('cm-gutter') ||
                    className.includes('cm-cursor') ||
                    className.includes('cm-selection') ||
                    className.includes('cm-layer') ||
                    className.includes('cm-announced') ||
                    className.includes('ne-codeblock-copy') ||
                    className.includes('ne-codeblock-inner') ||
                    className.includes('ne-card-container') ||
                    className.includes('ne-v-codeblock-hold')) {
                    return content; // 返回内容，忽略容器本身
                }
                
                // ne-viewer 特殊元素
                if (className.includes('ne-code')) {
                    // class 标识的内联代码
                    const raw = content.replace(/\n+/g, ' ');
                    const runs = raw.match(/`+/g);
                    let fenceLen = 1;
                    if (runs && runs.length) {
                        fenceLen = Math.max(...runs.map(s => s.length)) + 1;
                    }
                    const fence = '`'.repeat(fenceLen);
                    const needsPadding = raw.startsWith('`') || raw.endsWith('`') || raw.startsWith(' ') || raw.endsWith(' ');
                    return needsPadding ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
                }
                if (className.includes('ne-codeblock')) {
                    return content;
                }
                
                // 对于其他 div/span，返回内容
                return content;
                
            // 忽略的标签
            case 'script':
            case 'style':
                return '';
                
            default:
                // 未知标签，返回内容
                return content;
        }
    }

    convertTableToMarkdown(content) {
        if (!content || !content) return '';

        try {
            // 使用临时根表包裹传入内容，确保选择器稳定
            const dom = new JSDOM(`<!DOCTYPE html><html><body><table class="__root">${content}</table></body></html>`);
            const document = dom.window.document;
            const rootTable = document.querySelector('table.__root');
            if (!rootTable) return '';

            const rows = rootTable.querySelectorAll('tr, .ne-tr');
            if (rows.length === 0) {
                const cleanContent = this.cleanHtmlTags(content);
                return cleanContent ? `\n\`\`\`\n${cleanContent}\n\`\`\`\n` : '';
            }

            const escapeCell = (s) => {
                return (s || '')
                    .replace(/\u200B|\uFEFF/g, '')     // 零宽字符
                    .replace(/\u00A0/g, ' ')           // NBSP -> 空格
                    .replace(/\r\n?/g, '\n')         // 统一换行
                    .replace(/\|/g, '\\|')           // 转义管道
                    .split('\n')
                    .map(line => line.trimEnd())
                    .join('<br>');                      // 单元格内换行 -> <br>
            };

            let markdown = '';
            let headerEmitted = false;

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const cells = row.querySelectorAll('th, td, .ne-td');
                if (cells.length === 0) continue;

                const hasTh = row.querySelectorAll('th').length > 0;
                const isHeaderRow = hasTh || (!headerEmitted && i === 0);

                const cellContents = [];
                for (let j = 0; j < cells.length; j++) {
                    const cell = cells[j];

                    const contentDiv = cell.querySelector('.ne-td-content');
                    let cellMd = '';

                    const collect = (node) => {
                        if (!node) return;
                        for (let child of node.childNodes) {
                            cellMd += this.convertDomNodeToMarkdown(child);
                        }
                    };
                    if (contentDiv) collect(contentDiv); else collect(cell);

                    // 保留逻辑结构：合并多余空行，保留“换行 -> <br>”
                    cellMd = cellMd.replace(/\n{2,}/g, '\n');
                    cellContents.push(escapeCell(cellMd) || ' ');
                }

                markdown += '| ' + cellContents.join(' | ') + ' |\n';

                if (!headerEmitted && isHeaderRow) {
                    const separator = cellContents.map(() => '---').join(' | ');
                    markdown += '| ' + separator + ' |\n';
                    headerEmitted = true;
                }
            }

            return markdown || `\n\`\`\`\n${this.cleanHtmlTags(content)}\n\`\`\`\n`;

        } catch (error) {
            console.log('表格解析失败，使用备用方法:', error.message);
            const cleanContent = this.cleanHtmlTags(content);
            return cleanContent ? `\n\`\`\`\n${cleanContent}\n\`\`\`\n` : '';
        }
    }

    extractCodeFromCard(content, attributes = {}) {
        // 从ne-card代码块中提取实际的代码内容
        if (!content) {
            console.log('代码块内容为空');
            return '';
        }
        
        let language = '';
        let codeContent = '';
        
        try {
            // 创建DOM来解析代码块内容
            const dom = new JSDOM(`<!DOCTYPE html><html><body>${content}</body></html>`);
            const document = dom.window.document;
            
            // 尝试从data-codeblock-mode属性获取语言
            const codeblockElement = document.querySelector('[data-codeblock-mode]');
            if (codeblockElement) {
                language = codeblockElement.getAttribute('data-codeblock-mode') || '';
                console.log('找到代码块语言(codeblock-mode):', language);
            }
            
            // 如果没有找到，尝试从data-language属性获取
            if (!language) {
                const contentElement = document.querySelector('[data-language]');
                if (contentElement) {
                    language = contentElement.getAttribute('data-language') || '';
                    console.log('找到代码块语言(data-language):', language);
                    // 处理shell -> bash的转换
                    if (language === 'shell') {
                        language = 'bash';
                    }
                }
            }
            
            // 提取代码行内容
            const codeLines = document.querySelectorAll('.cm-line');
            console.log(`代码块中找到 ${codeLines.length} 行代码`);
            
            if (codeLines.length > 0) {
                const lines = [];
                codeLines.forEach((line, index) => {
                    // 直接获取文本内容，保留空格
                    let lineText = '';
                    
                    // 遍历cm-line的所有子节点
                    const walkNodes = (node) => {
                        if (node.nodeType === 3) { // TEXT_NODE
                            lineText += node.textContent;
                        } else if (node.nodeType === 1) { // ELEMENT_NODE
                            if (node.tagName.toLowerCase() === 'br') {
                                // 行内 br 忽略，避免多一层换行
                                return;
                            }
                            // 递归处理子节点
                            for (let child of node.childNodes) {
                                walkNodes(child);
                            }
                        }
                    };
                    
                    for (let child of line.childNodes) {
                        walkNodes(child);
                    }
                    
                    if (index < 3) { // 只打印前3行作为调试
                        console.log(`  行 ${index + 1}: "${lineText}"`);
                    }
                    lines.push(lineText || ''); // 保留空行
                });
                codeContent = lines.join('\n');
            } else {
                // 兜底：从常见容器拉取纯文本
                const fallback =
                    document.querySelector('.cm-content') ||
                    document.querySelector('.ne-codeblock-inner') ||
                    document.querySelector('pre code') ||
                    document.querySelector('pre') ||
                    document.querySelector('code');
                if (fallback) {
                    codeContent = fallback.textContent || '';
                }
            }
            
        } catch (error) {
            console.log('代码块解析失败，使用备用方法:', error.message);
            // 备用方法：直接清理HTML标签
            codeContent = this.cleanHtmlTags(content, true);
            
            // 尝试从内容中提取语言标识符
            const languageMatch = content.match(/data-codeblock-mode="([^"]+)"/i) || 
                                 content.match(/data-language="([^"]+)"/i);
            if (languageMatch) {
                language = languageMatch[1].toLowerCase();
                if (language === 'shell') {
                    language = 'bash';
                }
            }
        }
        
        // 清理代码内容
        codeContent = codeContent
            .replace(/\u200B/g, ''); // 移除零宽度空格
        
        // 如果内容不为空，格式化为代码块
        if (codeContent.length > 0) {
            return `\n\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
        }
        
        return '';
    }

    escapeMarkdown(text) {
        if (!text) return '';
        
        // 转换HTML实体
        let out = text
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&hellip;/g, '...');

        // 为了避免 Markdown 将 <...> 解析为 HTML 标签，统一转义尖括号
        // 代码块与内联代码不会走到这里（有各自处理），因此这里的全局转义是安全的
        out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return out;
    }
    
    cleanHtmlTags(html, preserveWhitespace = false) {
        if (!html) return '';
        
        let cleaned = html
            .replace(/<script[^>]*>.*?<\/script>/gis, '') // 移除脚本
            .replace(/<style[^>]*>.*?<\/style>/gis, '') // 移除样式
            .replace(/<[^>]+>/g, ''); // 移除HTML标签
        
        if (!preserveWhitespace) {
            cleaned = cleaned
                .replace(/&nbsp;/g, ' ') // 转换HTML实体
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\s+/g, ' ') // 多个空白字符合并为一个空格
                ;
        } else {
            // 对于代码块，保持原有格式
            cleaned = cleaned
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
        }
        
        return cleaned;
    }

    generateReport() {
        console.log('\n=== 爬取统计报告 ===');
        console.log(`总文章数: ${this.articles.length}`);
        
        // 按分类统计
        const categoryStats = {};
        this.articles.forEach(article => {
            const cat = article.category || '未分类';
            categoryStats[cat] = (categoryStats[cat] || 0) + 1;
        });
        
        console.log('\n按分类统计:');
        Object.entries(categoryStats)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, count]) => {
                console.log(`  ${category}: ${count} 篇`);
            });
        
        // 按日期统计
        const dateStats = {};
        this.articles.forEach(article => {
            if (article.publishTime) {
                const date = article.publishTime.split(' ')[0];
                dateStats[date] = (dateStats[date] || 0) + 1;
            }
        });
        
        console.log('\n按日期统计 (前10天):');
        Object.entries(dateStats)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 10)
            .forEach(([date, count]) => {
                console.log(`  ${date}: ${count} 篇`);
            });

        // 最新文章
        console.log('\n最新5篇文章:');
        this.articles
            .sort((a, b) => new Date(b.publishTime) - new Date(a.publishTime))
            .slice(0, 5)
            .forEach((article, index) => {
                console.log(`  ${index + 1}. ${article.title} (${article.publishTime})`);
            });
    }

    // ============ Images-only mode helpers ============
    async localizeImagesInPapers() {
        const papersDir = path.join(__dirname, 'papers');
        const imagesDir = path.join(papersDir, 'images');

        if (!fs.existsSync(papersDir)) {
            console.log('papers 文件夹不存在，跳过');
            return;
        }
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
            console.log(`创建文件夹: ${imagesDir}`);
        }

        const all = fs.readdirSync(papersDir).filter(f => f.toLowerCase().endsWith('.md'));
        if (all.length === 0) {
            console.log('papers 下没有 Markdown 文件，跳过');
            return;
        }

        console.log(`开始本地化 ${all.length} 个 Markdown 文件中的图片...`);

        let totalImages = 0;
        let downloaded = 0;
        for (const mdName of all) {
            const mdPath = path.join(papersDir, mdName);
            const raw = fs.readFileSync(mdPath, 'utf8');

            const imageRegex = /!\[[^\]]*\]\((https?:[^)\s]+)(?:\s+"[^"]*")?\)/g;
            const replacements = [];
            let match;
            while ((match = imageRegex.exec(raw)) !== null) {
                totalImages++;
                const full = match[0];
                const url = match[1];
                const hashed = this.sha1(url).slice(0, 32);
                const ext = this.inferImageExt(url);
                const fileName = `${hashed}${ext}`;
                const localPath = path.join(imagesDir, fileName);
                const localRel = `images/${fileName}`;
                try {
                    if (!fs.existsSync(localPath)) {
                        await this.downloadWithReferer(url, localPath, 'https://xz.aliyun.com/');
                        downloaded++;
                    }
                    replacements.push({ full, url, repl: full.replace(url, localRel) });
                } catch (e) {
                    console.log(`下载失败: ${url} -> ${e.message}`);
                }
            }

            if (replacements.length) {
                let updated = raw;
                for (const r of replacements) {
                    updated = updated.split(r.full).join(r.repl);
                }
                fs.writeFileSync(mdPath, updated, 'utf8');
                console.log(`更新 ${mdName}: ${replacements.length} 处图片链接`);
            }
        }

        console.log(`完成：扫描图片 ${totalImages}，实际下载 ${downloaded}`);
    }

    inferImageExt(urlStr) {
        try {
            const u = new URL(urlStr);
            const p = u.pathname.toLowerCase();
            const m = p.match(/\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:$|\?)/);
            if (m) return `.${m[1] === 'jpg' ? 'jpg' : m[1]}`;
        } catch {}
        return '.jpg';
    }

    sha1(s) {
        return crypto.createHash('sha1').update(s).digest('hex');
    }

    downloadWithReferer(urlStr, destPath, referer = 'https://xz.aliyun.com/', redirectCount = 0) {
        const maxRedirects = 5;
        return new Promise((resolve, reject) => {
            const client = urlStr.startsWith('https') ? https : http;
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': referer
            };
            const req = client.get(urlStr, { headers }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    if (redirectCount >= maxRedirects) {
                        res.resume();
                        return reject(new Error('Too many redirects'));
                    }
                    const nextUrl = new URL(res.headers.location, urlStr).href;
                    res.resume();
                    return this.downloadWithReferer(nextUrl, destPath, referer, redirectCount + 1).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const ws = fs.createWriteStream(destPath);
                res.pipe(ws);
                ws.on('finish', () => ws.close(resolve));
                ws.on('error', (err) => {
                    fs.unlink(destPath, () => reject(err));
                });
            });
            req.on('error', reject);
            req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
        });
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('浏览器已关闭');
        }
    }

    async run() {
        try {
            if (this.imagesOnly) {
                // 仅处理 papers 下的 Markdown 图片本地化
                await this.localizeImagesInPapers();
                return;
            }

            await this.init();
            await this.navigateToNews();
            await this.scrapeArticles();
            await this.saveResults();
        } catch (error) {
            console.error('爬取过程中出错:', error);
        } finally {
            if (!this.imagesOnly) {
                await this.close();
            }
        }
    }
}

// 运行爬虫
async function main() {
    // 创建爬虫实例，支持 CLI/ENV/配置文件 参数化
    const argv = process.argv.slice(2);

    // 简单的 argv 解析器：支持 --key=value 或 --flag 形式
    const parseArgv = (args) => {
        const out = {};
        for (const a of args) {
            if (!a.startsWith('--')) continue;
            const [k, v] = a.replace(/^--/, '').split('=');
            if (v === undefined) {
                out[k] = true;
            } else {
                out[k] = v;
            }
        }
        return out;
    };
    const args = parseArgv(argv);

    // 可选：读取配置文件 config.json
    let fileCfg = {};
    try {
        const cfgPath = path.join(__dirname, 'config.json');
        if (fs.existsSync(cfgPath)) {
            const raw = fs.readFileSync(cfgPath, 'utf8');
            fileCfg = JSON.parse(raw);
        }
    } catch (e) {
        console.log('读取 config.json 失败，忽略:', e.message);
    }

    // 优先级：CLI > ENV > config.json > 默认
    const envGet = (key) => {
        const cased = [
            key,
            key.toUpperCase(),
            key.replace(/-/g, '_').toUpperCase(),
            key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(), // camelCase -> SNAKE_CASE
        ];
        for (const k of cased) {
            if (process.env[k] !== undefined) return process.env[k];
        }
        return undefined;
    };

    const pick = (keys, fallback) => {
        for (const k of keys) {
            if (args[k] !== undefined) return args[k];
            const envVal = envGet(k);
            if (envVal !== undefined) return envVal;
            if (fileCfg[k] !== undefined) return fileCfg[k];
        }
        return fallback;
    };

    const imagesOnlyRaw = args['images-only'] !== undefined ? args['images-only'] : pick(['imagesOnly'], false);
    const imagesOnly = imagesOnlyRaw === true || imagesOnlyRaw === 'true';
    const maxPagesRaw = pick(['maxPages', 'max-pages'], 1);
    const maxPages = Number(maxPagesRaw) > 0 ? Number(maxPagesRaw) : 1;
    const startDate = pick(['startDate', 'start-date'], undefined);
    const endDate = pick(['endDate', 'end-date'], undefined);
    const targetDate = pick(['targetDate', 'target-date'], undefined);

    const crawler = new XianzhiCrawler({
        fetchFullContent: !imagesOnly,
        maxPages,
        imagesOnly,
        startDate,
        endDate,
        targetDate,
    });
    console.log('配置:', {
        imagesOnly,
        maxPages,
        startDate,
        endDate,
        targetDate,
    });
    await crawler.run();
}

// 如果直接运行此脚本
if (require.main === module) {
    main().catch(console.error);
}

module.exports = XianzhiCrawler;