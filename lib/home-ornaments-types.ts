export type OrnamentTone = "up" | "down" | "neutral";

export type OrnamentMetric = {
  label: string;
  value: string;
  tone?: OrnamentTone;
};

export type OrnamentIndexItem = {
  name: string;
  price: string;
  change: string;
  tone: OrnamentTone;
};

export type HomeMarketView = {
  key: string;
  label: string;
  name: string;
  primary: OrnamentMetric;
  secondary: OrnamentMetric;
  indices: OrnamentIndexItem[];
  note: string;
  asOf: string;
};

export type HomeSentimentView = {
  key: string;
  label: string;
  mode: "sentiment" | "news";
  score?: number;
  summary: string;
  newsCount: number;
  headline: string;
  description: string;
  highlights: string[];
  note: string;
  components?: OrnamentMetric[];
  asOf: string;
};

export type HomeOrnamentsPayload = {
  ok: true;
  fetchedAt: string;
  marketViews: HomeMarketView[];
  sentimentViews: HomeSentimentView[];
  sources: string[];
};
