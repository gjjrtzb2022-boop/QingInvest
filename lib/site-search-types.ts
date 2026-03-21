export type SearchSuggestionKind = "article" | "stock" | "tag";

export type SearchSuggestionMatchMode = "exact" | "prefix" | "partial";

export type SearchSuggestion = {
  id: string;
  kind: SearchSuggestionKind;
  title: string;
  subtitle: string;
  preview: string;
  href: string;
  badge?: string;
  matchMode: SearchSuggestionMatchMode;
};

export type SearchSuggestionResponse = {
  query: string;
  articles: SearchSuggestion[];
  stocks: SearchSuggestion[];
  tags: SearchSuggestion[];
  bestMatch: SearchSuggestion | null;
};
