#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(process.cwd());
const articlesDir = path.join(rootDir, "content", "articles");

const defaultOptions = {
  inputPath: "",
  date: formatLocalDate(new Date()),
  explicitDate: false,
  title: "",
  slug: "",
  series: "",
  category: "",
  status: "unread",
  sourceUrl: "",
  cover: "",
  dryRun: false
};

const TAG_RULES = [
  { tag: "富裕家庭的教育与传承问题研究", keywords: ["富裕家庭", "教育与传承", "教育", "传承", "家风", "家族"] },
  { tag: "闭关营", keywords: ["闭关营", "闭关师"] },
  { tag: "思维", keywords: ["思维", "思维训练", "思维层次"] },
  { tag: "沟通", keywords: ["沟通", "交流", "角色扮演", "共情"] },
  { tag: "价投方法心得", keywords: ["价值投资", "确定性", "避坑", "长期", "复利", "赔率"] },
  { tag: "个股分析", keywords: ["个股", "标的", "买入", "卖出", "持仓", "换仓"] },
  { tag: "行业研究", keywords: ["行业", "赛道", "景气", "周期", "供需"] },
  { tag: "企业估值", keywords: ["估值", "估价", "市盈率", "市净率", "PE", "PB"] },
  { tag: "银行股", keywords: ["银行", "城商行", "农商行"] },
  { tag: "股息率", keywords: ["股息", "分红", "派息", "吃息"] },
  { tag: "现金流", keywords: ["现金流", "经营现金流", "自由现金流"] },
  { tag: "盈利质量", keywords: ["盈利质量", "净利率", "毛利率", "ROE", "ROIC"] },
  { tag: "风险控制", keywords: ["风险", "回撤", "止损", "仓位", "风控"] },
  { tag: "低估值", keywords: ["低估", "折价", "便宜", "安全垫"] },
  { tag: "融资策略", keywords: ["融资", "借款", "杠杆", "融券", "利息"] },
  { tag: "组合管理", keywords: ["组合", "分散", "仓位", "配置"] },
  { tag: "财富管理", keywords: ["财富自由", "资产配置", "家庭资产", "消费"] }
];

const INDUSTRY_RULES = [
  { industry: "教育", keywords: ["教育", "训练", "闭关营", "家长", "孩子", "沟通", "传承"] },
  { industry: "银行", keywords: ["银行", "城商行", "农商行"] },
  { industry: "保险", keywords: ["保险", "保费"] },
  { industry: "券商", keywords: ["券商", "证券", "投行"] },
  { industry: "有色金属", keywords: ["有色", "铜", "铝", "锌", "金属"] },
  { industry: "消费", keywords: ["消费", "白酒", "食品", "零售"] },
  { industry: "医药", keywords: ["医药", "制药", "创新药", "医疗"] },
  { industry: "能源", keywords: ["煤炭", "石油", "天然气", "电力", "能源"] },
  { industry: "科技", keywords: ["半导体", "芯片", "互联网", "软件", "AI"] },
  { industry: "地产", keywords: ["地产", "房地产", "物业"] }
];

const HELP_TEXT = `
用法：
  node tools/import-article.mjs [原文文件路径] [可选参数]
  node tools/import-article.mjs < raw.txt

可选参数：
  --date=YYYY-MM-DD   文章日期（默认今天）
  --title=标题         强制指定标题
  --slug=slug         强制指定 slug
  --series=系列名      指定系列
  --category=分类名    指定分类
  --status=状态        unread/read/favorite（默认 unread）
  --source-url=URL    原文链接（可选，默认自动解析“链接：”）
  --cover=URL         封面图链接（可空）
  --dry-run           只预览，不写入文件
  --help              查看帮助
`;

main().catch((error) => {
  console.error(`导入失败：${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  await ensureArticlesDir();
  const source = await readSource(options.inputPath);
  if (!source.trim()) {
    throw new Error("没有读取到正文内容，请粘贴后按 Ctrl+D，或传入文本文件路径。");
  }

  const parsed = parseStructuredSource(source);
  const extracted = extractTitleAndBody(parsed.cleanedBody);
  const title = sanitizeInline(options.title || parsed.suggestedTitle || extracted.title || "未命名文章");
  const body = normalizeBody(extracted.body);
  if (!body) {
    throw new Error("正文为空，请检查输入内容。");
  }

  const date = options.explicitDate ? options.date : parsed.editedDate || options.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("--date 格式必须是 YYYY-MM-DD");
  }

  const inferredSeriesCategory = inferSeriesCategory(`${title}\n${body}`);
  const series = sanitizeInline(options.series || inferredSeriesCategory.series);
  const category = sanitizeInline(options.category || inferredSeriesCategory.category);
  const sourceUrl = sanitizeInline(options.sourceUrl || parsed.sourceUrl);
  const sourcePlatform = normalizeSourcePlatformName(parsed.sourcePlatform || inferSourcePlatformFromUrl(sourceUrl));
  const sourceKey = deriveSourceKey(sourcePlatform);
  const author = sanitizeInline(parsed.author);

  const draftTags = inferTags(`${title}\n${body}`);
  const draftIndustries = inferIndustries(`${title}\n${body}`);
  const draftStocks = inferStocks(body);
  const summary = createSummary(body, title, sourceUrl);

  const usedSlugs = await readExistingSlugs();
  const preferredSlug = sanitizeSlug(options.slug || createSlugFromTitle(title, date));
  if (!preferredSlug) {
    throw new Error("无法生成 slug，请用 --slug 手动指定（仅支持 a-z、0-9、-）。");
  }
  const slug = ensureUniqueSlug(preferredSlug, usedSlugs);

  const fileName = `${slug}.md`;
  const filePath = path.join(articlesDir, fileName);

  const markdown = buildMarkdown({
    slug,
    title,
    date,
    series,
    category,
    status: sanitizeStatus(options.status),
    tags: draftTags,
    industries: draftIndustries,
    stocks: draftStocks,
    cover: sanitizeInline(options.cover),
    summary,
    sourceUrl,
    sourcePlatform,
    source: sourceKey,
    author,
    body
  });

  if (options.dryRun) {
    console.log(`预览模式：将写入 ${filePath}`);
    console.log(markdown);
    return;
  }

  await fs.writeFile(filePath, markdown, "utf8");

  console.log(`已创建：${filePath}`);
  console.log(`title: ${title}`);
  console.log(`slug: ${slug}`);
  console.log(`series: ${series || "(空)"}`);
  console.log(`category: ${category || "(空)"}`);
  console.log(`source_url: ${sourceUrl || "(空)"}`);
  console.log(`tags: ${draftTags.length ? draftTags.join(", ") : "(空)"}`);
  console.log(`industries: ${draftIndustries.length ? draftIndustries.join(", ") : "(空)"}`);
  console.log(`stocks: ${draftStocks.length ? draftStocks.join(", ") : "(空)"}`);
  console.log("下一步：运行 node tools/build-articles.mjs 重新生成索引。");
}

function parseArgs(args) {
  const options = { ...defaultOptions, help: false };

  for (const arg of args) {
    if (!arg.startsWith("--") && !options.inputPath) {
      options.inputPath = arg;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const pair = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (!pair) {
      throw new Error(`无法识别参数：${arg}`);
    }

    const key = pair[1];
    const value = pair[2];

    if (key === "date") {
      options.date = value;
      options.explicitDate = true;
      continue;
    }

    if (key === "source-url" || key === "source_url") {
      options.sourceUrl = value;
      continue;
    }

    if (key in options) {
      options[key] = value;
      continue;
    }

    throw new Error(`不支持参数 --${key}`);
  }

  return options;
}

async function ensureArticlesDir() {
  await fs.mkdir(articlesDir, { recursive: true });
}

async function readSource(inputPath) {
  if (inputPath) {
    const targetPath = path.resolve(rootDir, inputPath);
    return fs.readFile(targetPath, "utf8");
  }

  if (process.stdin.isTTY) {
    console.log("请粘贴原文，结束后按 Ctrl+D：");
  }

  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function extractTitleAndBody(source) {
  const lines = source.replace(/\r/g, "").split("\n");

  let title = "";
  let titleLineIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const titlePrefixMatch = line.match(/^标题\s*[:：]\s*(.+)$/i);
    if (titlePrefixMatch) {
      title = titlePrefixMatch[1].trim();
      titleLineIndex = i;
      break;
    }

    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      title = h1Match[1].trim();
      titleLineIndex = i;
      break;
    }
  }

  if (!title) {
    const firstNonEmptyIndex = lines.findIndex((line) => line.trim());
    if (firstNonEmptyIndex >= 0) {
      const firstLine = lines[firstNonEmptyIndex].trim();
      if (firstLine.length <= 80) {
        title = firstLine;
        titleLineIndex = firstNonEmptyIndex;
      }
    }
  }

  const bodyLines = lines.filter((_, index) => index !== titleLineIndex);
  const body = bodyLines.join("\n").trim();

  return { title, body };
}

function parseStructuredSource(source) {
  const normalized = source.replace(/\r/g, "");
  const frontmatter = extractFrontmatter(normalized);
  const contentSource = frontmatter ? frontmatter.body : normalized;
  const lines = contentSource.split("\n");
  const cleanedLines = [];

  let author = frontmatter?.meta.author || "";
  let sourceUrl = frontmatter?.meta.source_url || "";
  let sourcePlatform = frontmatter?.meta.source_platform || frontmatter?.meta.source || "";
  let editedDate = normalizeDateString(frontmatter?.meta.date || "");
  let suggestedTitle = sanitizeInline(frontmatter?.meta.title || "");
  let nonEmptyCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line) {
      nonEmptyCount += 1;
    }

    const authorMatch = line.match(/^作者\s*[:：]\s*(.+)$/);
    if (authorMatch) {
      author = sanitizeInline(authorMatch[1]);
      continue;
    }

    const linkMatch = line.match(/^链接\s*[:：]\s*(https?:\/\/\S+)$/i);
    if (linkMatch) {
      sourceUrl = sanitizeInline(linkMatch[1]);
      continue;
    }

    const sourceMatch = line.match(/^来源\s*[:：]\s*(.+)$/);
    if (sourceMatch) {
      sourcePlatform = sanitizeInline(sourceMatch[1]);
      continue;
    }

    const editedMatch = line.match(/^(?:编辑于|发布于)\s*(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2})?/);
    if (editedMatch) {
      editedDate = editedMatch[1];
      continue;
    }

    if (!sourceUrl) {
      const urlMatch = line.match(/https?:\/\/\S+/);
      if (urlMatch) {
        sourceUrl = sanitizeInline(urlMatch[0]);
        if (line === urlMatch[0]) {
          continue;
        }
      }
    }

    const zhihuTitleMatch = line.match(/^(.+?)\s*-\s*.+?的(?:文章|回答)\s*-\s*知乎$/);
    if (zhihuTitleMatch) {
      if (!suggestedTitle) {
        suggestedTitle = sanitizeInline(zhihuTitleMatch[1]);
      }
      continue;
    }

    if (!author && line && line.length <= 16 && /[\u4e00-\u9fa5]/.test(line) && !/[。！？!?：:]/.test(line)) {
      author = sanitizeInline(line);
      continue;
    }

    if (!suggestedTitle && line && nonEmptyCount <= 10 && line.length >= 8 && line.length <= 70 && /[？?]$/.test(line)) {
      suggestedTitle = sanitizeInline(line);
      continue;
    }

    if (/^著作权归作者所有/.test(line)) continue;
    if (/^商业转载请联系作者获得授权/.test(line)) continue;
    if (/^非商业转载请注明出处/.test(line)) continue;

    cleanedLines.push(rawLine);
  }

  let cleanedBody = normalizeBody(cleanedLines.join("\n"));
  cleanedBody = trimLeadingMetaLines(cleanedBody, { author, title: suggestedTitle });
  suggestedTitle = sanitizeInline(suggestedTitle || inferTitleFromBody(cleanedBody));

  return { author, sourceUrl, sourcePlatform, editedDate, cleanedBody, suggestedTitle };
}

function trimLeadingMetaLines(body, { author, title }) {
  const lines = body.split("\n");
  const out = [...lines];

  while (out.length) {
    const raw = out[0];
    const line = raw.trim();
    if (!line) {
      out.shift();
      continue;
    }

    if (title && line === title) {
      out.shift();
      continue;
    }

    if (author && normalizeName(line) === normalizeName(author)) {
      out.shift();
      continue;
    }

    if (/^(?:作者|来源|链接)\s*[:：]/.test(line)) {
      out.shift();
      continue;
    }

    if (/https?:\/\/\S+/.test(line)) {
      out.shift();
      continue;
    }

    if (/^(?:发布于|编辑于)\s*\d{4}-\d{2}-\d{2}/.test(line)) {
      out.shift();
      continue;
    }

    if (line.length <= 40 && /(创办人|独立投资人|传武|无私域|不接广|不卖课|文人格斗)/.test(line)) {
      out.shift();
      continue;
    }

    break;
  }

  return out.join("\n").trim();
}

function normalizeName(input) {
  return String(input || "")
    .replace(/[\u200b\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function extractFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;

  const rawMeta = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const meta = {};

  for (const line of rawMeta.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    meta[key] = value;
  }

  return { meta, body };
}

function normalizeDateString(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function inferTitleFromBody(body) {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const firstSentenceMatch = compact.match(/^(.{10,90}?[。！？.!?])/);
  let candidate = firstSentenceMatch ? firstSentenceMatch[1] : compact.slice(0, 70);
  candidate = candidate.replace(/[。！？.!?]+$/, "").trim();

  if (candidate.length > 36) {
    return `${candidate.slice(0, 36)}...`;
  }

  return candidate;
}

function inferSeriesCategory(text) {
  const input = text || "";

  if (containsAny(input, ["闭关营", "沟通训练", "角色扮演", "人生欲望", "沟通交流"])) {
    return { series: "专题随笔", category: "专题随笔" };
  }

  if (containsAny(input, ["感言", "财富自由", "避坑", "投资思维", "投资心态", "妄念", "心性"])) {
    return { series: "投资心法", category: "投资心法" };
  }

  if (containsAny(input, ["今日看盘", "看盘", "盘面", "复盘", "收盘", "指数"])) {
    return { series: "每日市场评论", category: "市场评论" };
  }

  if (containsAny(input, ["如何看待", "股票", "个股", "标的", "买入", "卖出", "持仓", "换仓"])) {
    return { series: "个股研究", category: "个股研究" };
  }

  if (containsAny(input, ["估值", "市盈率", "市净率", "股息", "分红", "安全垫"])) {
    return { series: "估值方法", category: "估值方法" };
  }

  if (containsAny(input, ["行业", "赛道", "有色", "银行", "医药", "消费", "能源"])) {
    return { series: "行业研究", category: "行业研究" };
  }

  if (containsAny(input, ["换仓", "仓位", "止盈", "止损", "风控", "回撤", "配置"])) {
    return { series: "组合与风控", category: "组合与风控" };
  }

  return { series: "投资思考", category: "投资思考" };
}

function normalizeBody(body) {
  const compact = body
    .replace(/^\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripNonBodySections(compact);
}

function createSummary(body, title, sourceUrl) {
  if (sourceUrl.includes("zhuanlan.zhihu.com")) {
    return `发表了文章 - ${title}`;
  }

  if (sourceUrl.includes("zhihu.com/question/") && sourceUrl.includes("/answer/")) {
    return `回答了问题 - ${title}`;
  }

  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const sentence = compact.match(/^(.{30,140}?[。！？.!?])/);
  if (sentence) {
    return sentence[1].trim();
  }

  return compact.length > 140 ? `${compact.slice(0, 140)}...` : compact;
}

function inferTags(text) {
  const out = [];
  for (const rule of TAG_RULES) {
    if (containsAny(text, rule.keywords)) {
      out.push(rule.tag);
    }
    if (out.length >= 6) break;
  }

  return out;
}

function inferIndustries(text) {
  const out = [];
  for (const rule of INDUSTRY_RULES) {
    if (containsAny(text, rule.keywords)) {
      out.push(rule.industry);
    }
    if (out.length >= 3) break;
  }
  return out;
}

function inferStocks(text) {
  const out = [];
  const stopPrefixes = [
    "讨论",
    "分析",
    "目前",
    "这个",
    "那个",
    "一家",
    "这种",
    "这些",
    "那些",
    "认为",
    "如果",
    "因为",
    "今天",
    "现在",
    "未来",
    "利润",
    "场上",
    "热点"
  ];

  const namedCodeRegex = /([\u4e00-\u9fa5A-Za-z]{2,16})\s*\(([A-Za-z]{2})\s*[:：]?\s*(\d{6})\)/g;
  let namedCodeMatch = namedCodeRegex.exec(text);
  while (namedCodeMatch) {
    const name = namedCodeMatch[1].trim();
    const market = namedCodeMatch[2].toUpperCase();
    if ((market === "SH" || market === "SZ") && !stopPrefixes.some((prefix) => name.startsWith(prefix))) {
      out.push(`${name}(${market}:${namedCodeMatch[3]})`);
    }
    namedCodeMatch = namedCodeRegex.exec(text);
  }

  const codeRegex = /([A-Za-z]{2})\s*[:：]?\s*(\d{6})/g;
  let codeMatch = codeRegex.exec(text);
  while (codeMatch) {
    const market = codeMatch[1].toUpperCase();
    if (market === "SH" || market === "SZ") {
      out.push(`${market}:${codeMatch[2]}`);
    }
    codeMatch = codeRegex.exec(text);
  }

  const directCodeRegex = /\b(\d{5,6})\s*\.\s*(SH|SZ|HK)\b/gi;
  let directCodeMatch = directCodeRegex.exec(text);
  while (directCodeMatch) {
    out.push(`${directCodeMatch[1]}.${directCodeMatch[2].toUpperCase()}`);
    directCodeMatch = directCodeRegex.exec(text);
  }

  const cnNameRegex = /([\u4e00-\u9fa5]{1,4}(?:有色|银行|股份|集团|科技|能源|保险|证券|矿业|啤酒|医药))/g;
  let nameMatch = cnNameRegex.exec(text);
  while (nameMatch) {
    const rawValue = nameMatch[1].trim();
    const value = rawValue.replace(
      /^(?:买入|买进|卖出|卖掉|换仓|清仓|持有|持仓|增仓|减仓|正在思考|正在|思考|都用来|用来)/,
      ""
    );
    if (!/^[\u4e00-\u9fa5A-Za-z]{1,4}(?:有色|银行|股份|集团|科技|能源|保险|证券|矿业|啤酒|医药)$/.test(value)) {
      nameMatch = cnNameRegex.exec(text);
      continue;
    }
    if (value.length < 2) {
      nameMatch = cnNameRegex.exec(text);
      continue;
    }
    if (/^[的是在和及]\S+$/.test(value)) {
      nameMatch = cnNameRegex.exec(text);
      continue;
    }
    if (!stopPrefixes.some((prefix) => value.startsWith(prefix))) {
      out.push(value);
    }
    nameMatch = cnNameRegex.exec(text);
  }

  const unique = uniqueOrdered(out);
  const namedEntries = unique
    .map((item) => item.match(/^(.*)\((SH|SZ):(\d{6})\)$/))
    .filter(Boolean);
  const namedCodes = new Set(namedEntries.map((match) => `${match[2]}:${match[3]}`));
  const namedNames = new Set(namedEntries.map((match) => match[1]));

  return unique
    .filter((item) => {
      if (/^(SH|SZ):\d{6}$/.test(item) && namedCodes.has(item)) {
        return false;
      }
      if (namedNames.has(item)) {
        return false;
      }
      return true;
    })
    .slice(0, 6);
}

function stripNonBodySections(body) {
  if (!body) return body;
  let output = body.trim();

  const bodyMarker = "## 正文内容";
  const bodyMarkerIndex = output.indexOf(bodyMarker);
  if (bodyMarkerIndex !== -1) {
    output = output.slice(bodyMarkerIndex + bodyMarker.length).trim();
  }

  output = output
    .replace(/^#\s+.+\n(?:\n)?-+\n?/m, "")
    .replace(/^\*\*发布时间\*\*.*$/gm, "")
    .replace(/^\*\*作者信息\*\*.*$/gm, "")
    .replace(/^(?:\s*-{3,}\s*\n)+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const markers = [
    "\n## 精选评论",
    "\n## 相关阅读",
    "\n*本文件由自动脚本",
    "\n**作者**:",
    "\n---\n\n## 精选评论",
    "\n---\n\n## 相关阅读"
  ];

  let cutIndex = -1;
  for (const marker of markers) {
    const idx = output.indexOf(marker);
    if (idx !== -1 && (cutIndex === -1 || idx < cutIndex)) {
      cutIndex = idx;
    }
  }

  return cutIndex === -1 ? output : output.slice(0, cutIndex).trim();
}

function inferSourcePlatformFromUrl(url) {
  if (!url) return "";
  if (url.includes("zhihu.com")) return "知乎";
  if (url.includes("x.com") || url.includes("twitter.com")) return "X";
  if (url.includes("weixin.qq.com")) return "微信公众号";
  return "";
}

function normalizeSourcePlatformName(value) {
  if (!value) return "";
  const input = String(value).trim().toLowerCase();
  if (input === "zhihu" || input === "知乎") return "知乎";
  if (input === "x" || input === "twitter" || input === "x.com" || input === "twitter.com") return "X";
  if (input === "wechat" || input === "公众号" || input === "微信公众号") return "微信公众号";
  return String(value).trim();
}

function deriveSourceKey(platform) {
  if (!platform) return "";
  if (platform === "知乎") return "zhihu";
  if (platform === "X") return "x";
  if (platform === "微信公众号") return "wechat";
  return platform.toLowerCase();
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

async function readExistingSlugs() {
  const entries = await fs.readdir(articlesDir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.replace(/\.md$/, ""))
  );
}

function createSlugFromTitle(title, date) {
  const normalized = title
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);

  const dateToken = date.replace(/-/g, "");
  if (normalized && /[a-z]/.test(normalized) && normalized.length >= 4) {
    return `${normalized}-${dateToken}`;
  }

  return `qingyishanzhang-${dateToken}`;
}

function sanitizeSlug(slug) {
  return String(slug)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureUniqueSlug(baseSlug, usedSlugs) {
  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let index = 2;
  while (usedSlugs.has(`${baseSlug}-${index}`)) {
    index += 1;
  }
  return `${baseSlug}-${index}`;
}

function sanitizeInline(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeStatus(status) {
  if (["unread", "read", "favorite"].includes(status)) {
    return status;
  }
  return "unread";
}

function buildMarkdown(meta) {
  const lines = [
    "---",
    `slug: \"${escapeYaml(meta.slug)}\"`,
    `title: \"${escapeYaml(meta.title)}\"`,
    `date: \"${escapeYaml(meta.date)}\"`,
    `series: \"${escapeYaml(meta.series)}\"`,
    `category: \"${escapeYaml(meta.category)}\"`,
    `status: \"${escapeYaml(meta.status)}\"`,
    renderArrayField("tags", meta.tags),
    renderArrayField("industries", meta.industries),
    renderArrayField("stocks", meta.stocks),
    `cover: \"${escapeYaml(meta.cover)}\"`,
    `summary: \"${escapeYaml(meta.summary)}\"`,
    `source: \"${escapeYaml(meta.source)}\"`,
    `source_url: \"${escapeYaml(meta.sourceUrl)}\"`,
    `source_platform: \"${escapeYaml(meta.sourcePlatform)}\"`,
    `author: \"${escapeYaml(meta.author)}\"`,
    "---",
    meta.body,
    ""
  ];

  return lines.join("\n");
}

function renderArrayField(key, values) {
  if (!values.length) {
    return `${key}: []`;
  }

  return `${key}:\n${values.map((value) => `  - \"${escapeYaml(value)}\"`).join("\n")}`;
}

function escapeYaml(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\"/g, '\\"');
}

function uniqueOrdered(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const value = sanitizeInline(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatLocalDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
