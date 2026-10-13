import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ROUTE_STAFF_RECORD } from '../../core/ui/Routes';
import { ErrorPanel, LoadingPanel } from '../../core/ui/StatePanel';
import { RepairRecordService } from './RepairRecordService';
import { RepairCategoryView, RepairRecordView, StaffRecordParam, repairRecordStatusLabel, repairResultLabel } from './StaffRepairContract';

export interface RecordListParam { library: boolean; }

@Component
export struct RepairRecordsPage {
  @Prop @Watch('refresh') refreshVersion: number = 0;
  param: RecordListParam = { library: false };
  onOpen: (route: string, param: Object | null) => void = () => {};
  onSessionExpired: () => void = () => {};
  @State items: RepairRecordView[] = [];
  @State categories: RepairCategoryView[] = [];
  @State loading: boolean = false;
  @State creating: boolean = false;
  @State errorText: string = '';
  @State query: string = '';
  @State status: string = '';
  @State category: string = '';
  @State result: string = '';
  @State from: string = '';
  @State to: string = '';
  @State typical: boolean = false;
  @State difficult: boolean = false;
  @State hasMore: boolean = false;
  private filter: string = '';
  private page: number = 0;
  private generation: number = 0;
  private categoryGeneration: number = 0;
  private retryReset: boolean = true;
  // 网络失败重试复用同一幂等键，成功后才换新。
  private createKey: string = RepairRecordService.createKey();
  aboutToAppear(): void { this.loadCategories(); this.load(true); }
  aboutToDisappear(): void { this.generation += 1; this.categoryGeneration += 1; this.loading = false; this.creating = false; }
  private refresh(): void { this.loadCategories(); this.load(true); }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error.message;
    } else this.errorText = '读取备案失败，请重试';
  }
  private categoryOptions(): SelectOption[] {
    const options: SelectOption[] = [{ value: '全部分类' }];
    return options.concat(this.categories.map((item: RepairCategoryView): SelectOption => ({ value: item.name })));
  }
  private async loadCategories(): Promise<void> {
    const generation = ++this.categoryGeneration;
    try { const items = await RepairRecordService.categories(); if (generation === this.categoryGeneration) this.categories = items; }
    catch (error) { if (generation === this.categoryGeneration) this.fail(error); }
  }
  private applyFilter(): void {
    if (this.loading || this.creating) return;
    this.filter = `&query=${encodeURIComponent(this.query.trim())}&categoryId=${encodeURIComponent(this.category)}&result=${this.result}&repairDateFrom=${encodeURIComponent(this.from.trim())}&repairDateTo=${encodeURIComponent(this.to.trim())}`;
    if (!this.param.library) this.filter += `&status=${this.status}`;
    if (this.typical) this.filter += '&isTypical=true';
    if (this.difficult) this.filter += '&isDifficult=true';
    this.load(true);
  }
  private async load(reset: boolean): Promise<void> {
    if (this.loading || this.creating) return;
    this.loading = true; this.errorText = ''; this.retryReset = reset;
    if (reset) { this.items = []; this.page = 0; this.hasMore = false; }
    const generation = ++this.generation, page = reset ? 1 : this.page + 1;
    try {
      const items = await RepairRecordService.list(!this.param.library, page, this.filter);
      if (generation !== this.generation) return;
      this.items = reset ? items : this.items.concat(items); this.page = page; this.hasMore = items.length === 20;
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async create(): Promise<void> {
    if (this.loading || this.creating || this.param.library) return;
    this.creating = true; this.errorText = '';
    const generation = this.generation;
    try {
      const record = await RepairRecordService.create(this.createKey);
      if (generation !== this.generation) return;
      this.createKey = RepairRecordService.createKey();
      const param: StaffRecordParam = { recordId: record.id, faultDescription: '' };
      this.onOpen(ROUTE_STAFF_RECORD, param);
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.creating = false; }
  }
  build() {
    Column({ space: 10 }) {
      Text(this.param.library ? '已审核维修备案 · 原始记录' : '本人维修备案').fontSize(20).fontWeight(FontWeight.Bold).width('100%')
      Text(this.param.library ? '仅内部成员可访问；与 AI 整理的 KnowledgeCase 分开。' : '独立备案与客户报修单分别管理。').fontSize(12).fontColor('#747A7F').width('100%')
      Row({ space: 8 }) {
        Button('刷新备案').enabled(!this.loading && !this.creating).onClick(() => { this.refresh(); })
        if (!this.param.library) { Button(this.creating ? '正在建草稿…' : '新建备案').enabled(!this.loading && !this.creating).onClick(() => { this.create(); }) }
      }.width('100%')
      TextInput({ text: this.query, placeholder: '搜索维修正文 / 备注' }).onChange((value: string) => { this.query = value; })
      Row({ space: 6 }) {
        if (!this.param.library) {
          Select([{ value: '全部状态' }, { value: '草稿' }, { value: '待审核' }, { value: '已通过' }, { value: '已退回' }])
            .value(this.status === '' ? '全部状态' : repairRecordStatusLabel(this.status)).layoutWeight(1)
            .onSelect((index: number) => { this.status = ['', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED'][index]; })
        }
        Select(this.categoryOptions())
          .value(this.category === '' ? '全部分类' : this.categories.find((item: RepairCategoryView) => item.id === this.category)?.name ?? '全部分类').layoutWeight(1)
          .onSelect((index: number) => { this.category = index === 0 ? '' : this.categories[index - 1].id; })
        Select([{ value: '全部结果' }, { value: '已完成' }, { value: '未完成' }]).layoutWeight(1)
          .value(this.result === '' ? '全部结果' : repairResultLabel(this.result))
          .onSelect((index: number) => { this.result = ['', 'COMPLETED', 'NOT_COMPLETED'][index]; })
      }.width('100%')
      Row({ space: 6 }) {
        TextInput({ text: this.from, placeholder: '起日 YYYY-MM-DD' }).layoutWeight(1).onChange((value: string) => { this.from = value; })
        TextInput({ text: this.to, placeholder: '止日 YYYY-MM-DD' }).layoutWeight(1).onChange((value: string) => { this.to = value; })
      }.width('100%')
      Row({ space: 5 }) {
        Checkbox().select(this.typical).onChange((value: boolean) => { this.typical = value; })
        Text('典型').fontSize(12)
        Checkbox().select(this.difficult).onChange((value: boolean) => { this.difficult = value; })
        Text('疑难').fontSize(12)
        Button('应用筛选').enabled(!this.loading && !this.creating).onClick(() => { this.applyFilter(); })
      }.width('100%')
      if (this.loading) { LoadingPanel({ text: '正在读取备案…' }) }
      if (this.errorText !== '') { ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(this.retryReset); } }) }
      List({ space: 10 }) {
        ForEach(this.items, (item: RepairRecordView) => {
          ListItem() {
            Column({ space: 8 }) {
              Text(item.deviceModel || item.category?.name || '未填写机型的备案').fontSize(18).fontWeight(FontWeight.Medium)
              Text(`${repairRecordStatusLabel(item.status)} · ${repairResultLabel(item.result)} · ${item.repairDate || '日期未填'}`).fontSize(12).fontColor('#52758C')
              Text(`作者：${item.member.name}${item.ownerName ? ' · 机主：' + item.ownerName : ''}`).fontSize(12)
              Text(item.content || '正文尚未填写').fontSize(14).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            }.width('100%').padding(16).backgroundColor(Color.White).borderRadius(18).alignItems(HorizontalAlign.Start)
              .onClick(() => { if (!this.loading && !this.creating) { const param: StaffRecordParam = { recordId: item.id, faultDescription: '' }; this.onOpen(ROUTE_STAFF_RECORD, param); } })
          }
        }, (item: RepairRecordView) => item.id)
        if (!this.loading && this.items.length === 0 && this.errorText === '') { ListItem() { Text('当前范围暂无维修备案').padding(20) } }
        if (this.hasMore) { ListItem() { Button('加载更多备案').enabled(!this.loading).onClick(() => { this.load(false); }) } }
      }.width('100%').layoutWeight(1)
    }.width('100%').height('100%').padding(16).backgroundColor('#F0F5F8')
  }
}
