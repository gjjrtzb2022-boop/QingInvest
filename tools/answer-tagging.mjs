const CATEGORY_BASE_TAGS = {
  教育: ["家庭教育", "学习成长"],
  武道体育: ["训练方法", "实战训练"],
  心理关系: ["关系沟通", "亲密关系"],
  社会: ["社会观察"],
  投资方法: ["价值投资", "风险管理"],
  行业: ["行业分析"],
  宏观: ["宏观观察"],
  风险: ["风险管理"]
};

const TAG_RULES = [
  { tag: "高考", keywords: ["高考", "中考", "985", "211", "升学"] },
  { tag: "大学教育", keywords: ["大学", "高校", "本科", "研究生", "毕业生"] },
  { tag: "留学", keywords: ["留学", "出国", "国际学生", "sat", "托福", "雅思"] },
  { tag: "英语学习", keywords: ["英语", "外语", "教材", "英语学习"] },
  { tag: "学习方法", keywords: ["学习方法", "刷题", "课程", "课堂", "训练营"] },
  { tag: "职业发展", keywords: ["就业", "求职", "职场", "工作", "失业"] },
  { tag: "价值投资", keywords: ["价值投资", "估值", "分红", "股息", "仓位", "回撤"] },
  { tag: "股票市场", keywords: ["股票", "股市", "个股", "a股", "港股"] },
  { tag: "风险管理", keywords: ["风险", "风控", "止损", "波动", "爆仓"] },
  { tag: "宏观观察", keywords: ["宏观", "贸易战", "关税", "美元", "经济"] },
  { tag: "行业分析", keywords: ["行业", "赛道", "供需", "周期", "景气"] },
  { tag: "实战训练", keywords: ["实战", "对抗", "发力", "步法", "站桩", "格斗"] },
  { tag: "体育赛事", keywords: ["比赛", "赛事", "冠军", "对决"] },
  { tag: "婚姻家庭", keywords: ["婚姻", "夫妻", "离婚", "妻子", "丈夫", "家庭"] },
  { tag: "亲密关系", keywords: ["女性", "男性", "两性", "恋爱", "再婚"] },
  { tag: "亲子关系", keywords: ["亲子", "家长", "父母", "孩子", "育儿"] },
  { tag: "心理成长", keywords: ["心理", "焦虑", "抑郁", "情绪", "成长"] },
  { tag: "社会观察", keywords: ["社会", "现象", "舆论", "新闻", "事件"] },
  { tag: "法律与安全", keywords: ["违法", "犯罪", "被捕", "判刑", "诈骗", "绑架", "安全"] },
  { tag: "道德哲学", keywords: ["道德经", "哲学", "价值观", "向死而生", "墓志铭"] },
  { tag: "财富观", keywords: ["财富", "中产", "资产", "继承", "财富自由"] }
];

const CATEGORY_ORDER = [
  "教育",
  "武道体育",
  "心理关系",
  "社会",
  "投资方法",
  "行业",
  "宏观",
  "风险"
];

const KEEP_AS_IS = new Set(["长文", "短内容"]);
const RESERVED_TAGS = new Set(["待整理", "未分类", "教育", "武道体育", "心理关系", "社会", "投资方法", "行业", "宏观", "风险", "武道"]);
const TAG_ALIASES = {
  心理健康: "心理成长",
  两性关系: "亲密关系",
  婚恋关系: "亲密关系",
  心理关系: "关系沟通",
  关系关系: "关系沟通"
};

export function buildAnswerTags({ title, body, category, existingTags = [], max = 7 }) {
  const normalizedCategory = normalize(category);
  const text = `${normalize(title)}\n${normalize(body)}`;
  const titleText = normalize(title);
  const output = [];

  output.push("回答");

  const categoryBase = CATEGORY_BASE_TAGS[normalizedCategory] || [];
  output.push(...categoryBase);

  const preserved = existingTags
    .map((tag) => canonicalTag(String(tag || "").trim()))
    .filter(Boolean)
    .filter((tag) => tag !== "回答")
    .filter((tag) => !RESERVED_TAGS.has(tag));

  for (const tag of preserved) {
    if (KEEP_AS_IS.has(tag)) continue;
    output.push(tag);
  }

  const scored = TAG_RULES.map((rule, index) => {
    let score = 0;
    for (const keyword of rule.keywords) {
      const target = normalize(keyword);
      if (!target) continue;
      if (text.includes(target)) score += 1;
      if (titleText.includes(target)) score += 1;
    }
    return { tag: rule.tag, score, index };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const entry of scored) {
    output.push(entry.tag);
  }

  const lengthTag = preserved.find((tag) => KEEP_AS_IS.has(tag));
  if (lengthTag) {
    output.push(lengthTag);
  }

  const ordered = unique(output.map(canonicalTag)).filter((item) => item && !RESERVED_TAGS.has(item));

  if (ordered.length > max) {
    const head = ordered.slice(0, max);
    if (lengthTag && !head.includes(lengthTag)) {
      return unique([...head.slice(0, max - 1), lengthTag]);
    }
    return head;
  }

  if (ordered.length < 3) {
    const fallbackCategory =
      CATEGORY_ORDER.find((item) => text.includes(item) || titleText.includes(item)) || "观点分析";
    return unique([...ordered, fallbackCategory]).slice(0, max);
  }

  return ordered;
}

export function buildAnswerIndustries({ title, body, category, existing = [] }) {
  const text = `${normalize(title)}\n${normalize(body)}`;
  const normalizedCategory = normalize(category);
  const out = existing.map((item) => String(item || "").trim()).filter(Boolean);

  if (normalizedCategory === "教育") {
    out.push("教育");
  }

  if (
    normalizedCategory === "武道体育" ||
    containsAny(text, ["武道", "形意", "太极", "咏春", "拳", "格斗", "站桩", "发力"])
  ) {
    out.push("武道");
  }

  if (normalizedCategory === "投资方法" || containsAny(text, ["股票", "估值", "股市", "分红", "仓位"])) {
    out.push("金融");
  }

  return unique(out);
}

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function canonicalTag(tag) {
  if (!tag) return "";
  return TAG_ALIASES[tag] || tag;
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(normalize(keyword)));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
