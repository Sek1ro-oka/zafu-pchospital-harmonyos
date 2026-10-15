export interface BrowseGuide { id: string; title: string; revision: string | null; }
export interface BrowseGuideList { guides: BrowseGuide[]; }
export interface BrowseCase {
  caseId: string; title: string; excerpt: string; contentVersion: number;
  visibility: string; sourceCount: number; updatedAt: string;
}
export interface BrowseCasePage { items: BrowseCase[]; page: number; pageSize: number; total: number; hasMore: boolean; }
export interface SearchHighlight { text: string; matched: boolean; }
export interface KnowledgeSearchParam { query: string; }

export function highlightQuery(text: string, query: string): SearchHighlight[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [{ text: text, matched: false }];
  const lower = text.toLowerCase(), parts: SearchHighlight[] = [];
  let from = 0, hit = lower.indexOf(needle);
  while (hit >= 0) {
    if (hit > from) parts.push({ text: text.slice(from, hit), matched: false });
    parts.push({ text: text.slice(hit, hit + needle.length), matched: true });
    from = hit + needle.length; hit = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push({ text: text.slice(from), matched: false });
  return parts;
}

export interface KnowledgeSearchState {
  query: string; type: string; guides: BrowseGuide[]; cases: BrowseCase[];
  guidesLoading: boolean; casesLoading: boolean; moreLoading: boolean;
  guideError: string; caseError: string; caseTotal: number; hasMore: boolean; page: number;
}
export function emptySearchState(query: string = '', type: string = 'all'): KnowledgeSearchState {
  return { query: query, type: type, guides: [], cases: [], guidesLoading: false, casesLoading: false,
    moreLoading: false, guideError: '', caseError: '', caseTotal: 0, hasMore: false, page: 0 };
}
export interface KnowledgeSearchDeps {
  guides: () => Promise<BrowseGuide[]>;
  cases: (query: string, page: number) => Promise<BrowseCasePage>;
  message: (error: Object) => string;
  changed: (state: KnowledgeSearchState) => void;
}

/** 查询/类型/离开都会作废旧代，分页只追加同一代已确认的下一页。 */
export class KnowledgeSearchController {
  state: KnowledgeSearchState = emptySearchState();
  private generation: number = 0;
  private deps: KnowledgeSearchDeps;
  constructor(deps: KnowledgeSearchDeps) { this.deps = deps; }
  private publish(): void { this.deps.changed(this.state); }
  invalidate(): void {
    this.generation += 1;
    this.state = { ...this.state, guidesLoading: false, casesLoading: false, moreLoading: false };
    this.publish();
  }
  async search(query: string, type: string, includeCases: boolean): Promise<void> {
    const generation = ++this.generation;
    const trimmed = query.trim();
    this.state = emptySearchState(query, type);
    if (trimmed === '') { this.publish(); return; }
    this.state.guidesLoading = type !== 'cases';
    this.state.casesLoading = includeCases && type !== 'guides';
    this.publish();
    await Promise.all([
      this.state.guidesLoading ? this.loadGuides(trimmed, generation) : Promise.resolve(),
      this.state.casesLoading ? this.loadCases(trimmed, generation) : Promise.resolve()
    ]);
  }
  private async loadGuides(query: string, generation: number): Promise<void> {
    try {
      const guides = await this.deps.guides();
      if (generation !== this.generation) return;
      this.state = { ...this.state, guides: guides.filter((guide: BrowseGuide) => guide.title.toLowerCase().includes(query.toLowerCase())) };
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { ...this.state, guideError: this.deps.message(error as Object) };
    } finally {
      if (generation === this.generation) { this.state = { ...this.state, guidesLoading: false }; this.publish(); }
    }
  }
  private async loadCases(query: string, generation: number): Promise<void> {
    try {
      const result = await this.deps.cases(query, 1);
      if (generation !== this.generation) return;
      this.state = { ...this.state, cases: result.items, page: result.page, caseTotal: result.total, hasMore: result.hasMore };
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { ...this.state, caseError: this.deps.message(error as Object) };
    } finally {
      if (generation === this.generation) { this.state = { ...this.state, casesLoading: false }; this.publish(); }
    }
  }
  async more(): Promise<void> {
    if (this.state.casesLoading || this.state.moreLoading || !this.state.hasMore) return;
    const generation = this.generation, page = this.state.page + 1, query = this.state.query.trim();
    this.state = { ...this.state, moreLoading: true, caseError: '' }; this.publish();
    try {
      const result = await this.deps.cases(query, page);
      if (generation !== this.generation) return;
      const ids = this.state.cases.map((item: BrowseCase) => item.caseId);
      this.state = { ...this.state, cases: this.state.cases.concat(result.items.filter((item: BrowseCase) => !ids.includes(item.caseId))),
        page: result.page, hasMore: result.hasMore, caseTotal: result.total };
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { ...this.state, caseError: this.deps.message(error as Object) };
    } finally {
      if (generation === this.generation) { this.state = { ...this.state, moreLoading: false }; this.publish(); }
    }
  }
}
