# 文章 GitHub 中转接入说明

## 目标

把文章内容从本地 `content/articles` 读取，切换为优先从 GitHub 仓库读取。

这样做的直接收益：

- 本地开发时不再必须依赖整套本地文章文件才能打开文章页
- 文章列表优先读取 `index.json`，不再先把全部正文读进内存
- 文章正文改成按需读取，打开哪篇就拉哪篇

## 当前支持

网站现在支持两种文章来源：

- `ARTICLE_SOURCE=local`
- `ARTICLE_SOURCE=github`

当切到 `github` 时，文章列表、文章正文、`published-slugs.json` 都会从 GitHub 读取。

## 环境变量

```env
ARTICLE_SOURCE=github
ARTICLE_GITHUB_OWNER=你的 GitHub 用户名
ARTICLE_GITHUB_REPO=你的文章仓库名
ARTICLE_GITHUB_BRANCH=main
ARTICLE_GITHUB_ARTICLES_PATH=.
ARTICLE_GITHUB_TOKEN=
```

说明：

- `ARTICLE_GITHUB_TOKEN` 为空时，默认按公开仓库读取
- 如果文章仓库是私有仓库，正文和索引可以通过 token 拉取
- 但私有仓库的正文图片和封面，浏览器无法直接读取 GitHub raw 地址

## 很重要的限制

如果你希望文章里的图片也正常显示，文章仓库最好是公开仓库，或者后续再做一层图片代理。

原因：

- 现在正文里的相对图片路径，在 GitHub 模式下会被改写成 GitHub raw 图片地址
- 浏览器端展示图片时，不能携带服务端 token
- 所以私有仓库下，文字可读，图片会失效

## 推荐的仓库内容

建议文章仓库至少包含下面这些内容：

```text
index.json
published-slugs.json
xxx.md
xxx/images/...
```

其中：

- `index.json` 用于文章列表快速加载
- `published-slugs.json` 用于控制哪些文章上线
- `*.md` 是正文
- `xxx/images/...` 是正文内联图片

## 推荐发布方式

推荐单独建一个公开 GitHub 仓库，只放文章源文件：

- 仓库默认分支 `main` 直接就是文章文件
- 仓库根目录直接放 `index.json`、`published-slugs.json`、`*.md`、`images`
- 网站读取 GitHub 时，把 `ARTICLE_GITHUB_ARTICLES_PATH` 设成 `.`

这样打开仓库就能直接看到全部文章，不会再和网站代码混在一起。

如果你暂时不想新建仓库，也仍然支持“同仓库 + `article-source` 分支”的旧方案。

## 一键导出文章仓包

项目里已经提供导出命令：

```bash
npm run export:article-source
```

导出结果在：

```text
dist/article-source/content/articles
```

你可以把这个目录的内容推送到文章 GitHub 仓库中。

如果你直接使用当前项目仓库作为中转层，现在还可以直接执行：

```bash
npm run publish:article-source
```

它会自动做三件事：

- 导出最新的 `content/articles`
- 发布到独立文章仓库
- 可以选择把文章直接发布到仓库根目录

## 切换步骤

1. 先执行：

```bash
npm run export:article-source
```

2. 把导出的 `dist/article-source/content/articles` 推送到 GitHub 仓库

3. 在 `.env.local` 里填入：

```env
ARTICLE_SOURCE=github
ARTICLE_GITHUB_OWNER=...
ARTICLE_GITHUB_REPO=...
ARTICLE_GITHUB_BRANCH=main
ARTICLE_GITHUB_ARTICLES_PATH=.
```

4. 重启开发服务

## 当前实现口径

这次改动已经同时优化了本地模式：

- 本地文章列表优先读取 `content/articles/index.json`
- 正文详情页按需读取单篇 markdown

也就是说，就算你暂时还没有切到 GitHub，当前本地模式本身也已经比之前更轻。
