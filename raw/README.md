# raw 目录说明

`raw/` 现在只负责三类东西：

- 待导入的原始 TXT
- 同步过程产生的报告与缓存
- 本地参考截图

## 目录约定

- `raw/*.txt`
  - 默认原文投递位置
  - `npm run import:raw` 默认扫描这里
- `raw/reference-screenshots/`
  - 对照截图、开发参考图
- `raw/stocks-cache/`
  - 股票同步缓存
- `raw/sync-reports/`
  - 环境检查、内容同步、股票同步报告
- `raw/_imported/`
  - 当你使用 `npm run import:raw -- --archive` 时，已导入原文会移到这里

## 推荐原文格式

```text
作者：山长 清一
链接：https://...
来源：知乎
著作权归作者所有。商业转载请联系作者获得授权，非商业转载请注明出处。

正文...

编辑于 2026-02-27 16:23
```

脚本会自动识别：

- 作者
- 原文链接
- 来源平台
- 编辑日期

## 常用命令

```bash
npm run import:raw
npm run import:raw -- --dry-run
npm run import:raw -- --archive
npm run import:raw -- --dir=raw/some-folder --recursive
```

导入完成后建议执行：

```bash
npm run validate:articles
npm run build:articles
```
