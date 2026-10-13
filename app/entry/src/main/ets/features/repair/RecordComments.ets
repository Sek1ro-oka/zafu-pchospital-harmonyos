import { ApiClient, ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { MemberDirectoryEntry } from '../profile/PersonalProfileContract';
import { PersonalProfileService } from '../profile/PersonalProfileService';
import { formatOrderTime } from './RepairOrderContract';

export interface CommentMember { id: string; name: string; }
export interface RecordComment { id: string; body: string; author: CommentMember; parentCommentId: string | null; mentions: CommentMember[]; createdAt: string; canDelete: boolean; replies: RecordComment[]; }
interface CommentInput { body: string; parentCommentId: string | null; mentionedMemberProfileIds: string[]; }

@Component
export struct RecordComments {
  @Prop recordId: string = '';
  onSessionExpired: () => void = () => {};
  @State items: RecordComment[] = [];
  @State loading: boolean = false;
  @State writing: boolean = false;
  @State errorText: string = '';
  @State body: string = '';
  @State replyId: string = '';
  @State replyName: string = '';
  @State mentionQuery: string = '';
  @State members: MemberDirectoryEntry[] = [];
  @State mentions: MemberDirectoryEntry[] = [];
  @State searching: boolean = false;
  @State searchPage: number = 0;
  @State searchMore: boolean = false;
  @State hasMore: boolean = false;
  private memberQuery: string = '';
  private page: number = 0;
  private generation: number = 0;
  private searchGeneration: number = 0;
  private retryReset: boolean = true;
  aboutToAppear(): void { this.load(true); }
  aboutToDisappear(): void { this.generation += 1; this.searchGeneration += 1; }
  private fail(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error.message;
    } else this.errorText = '评论操作失败，请重试';
  }
  private async token(): Promise<string> {
    const token = await SessionStore.readToken();
    if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
    return token;
  }
  private async load(reset: boolean): Promise<void> {
    if (this.loading || this.writing) return;
    this.loading = true; this.errorText = ''; this.retryReset = reset;
    if (reset) { this.items = []; this.page = 0; this.hasMore = false; }
    const generation = ++this.generation, page = reset ? 1 : this.page + 1;
    try {
      const items = await ApiClient.get<RecordComment[]>(ApiConfig.getBaseUrl(), `/api/v1/repairs/${this.recordId}/comments?page=${page}&pageSize=20`, await this.token());
      if (generation !== this.generation) return;
      this.items = reset ? items : this.items.concat(items); this.page = page; this.hasMore = items.length === 20;
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async search(reset: boolean): Promise<void> {
    if (this.searching || this.writing) return;
    this.searching = true; this.errorText = '';
    if (reset) { this.memberQuery = this.mentionQuery.trim(); this.members = []; this.searchPage = 0; this.searchMore = false; }
    const generation = ++this.searchGeneration;
    try {
      const result = await PersonalProfileService.directory(this.memberQuery, reset ? 1 : this.searchPage + 1);
      if (generation !== this.searchGeneration) return;
      this.members = reset ? result.items : this.members.concat(result.items); this.searchPage = result.page; this.searchMore = result.hasMore;
    } catch (error) { if (generation === this.searchGeneration) this.fail(error); }
    finally { if (generation === this.searchGeneration) this.searching = false; }
  }
  private toggle(member: MemberDirectoryEntry): void {
    if (this.writing) return;
    if (this.mentions.some((item: MemberDirectoryEntry) => item.memberProfileId === member.memberProfileId)) this.mentions = this.mentions.filter((item: MemberDirectoryEntry) => item.memberProfileId !== member.memberProfileId);
    else if (this.mentions.length < 10) this.mentions = this.mentions.concat([member]);
    else this.errorText = '最多提及 10 位成员';
  }
  private async send(): Promise<void> {
    if (this.writing || this.loading || this.body.trim() === '') return;
    this.writing = true; this.errorText = '';
    const generation = this.generation;
    const input: CommentInput = { body: this.body.trim(), parentCommentId: this.replyId || null, mentionedMemberProfileIds: this.mentions.map((item: MemberDirectoryEntry) => item.memberProfileId) };
    try {
      await ApiClient.post<RecordComment>(ApiConfig.getBaseUrl(), `/api/v1/repairs/${this.recordId}/comments`, JSON.stringify(input), await this.token());
      if (generation !== this.generation) return;
      this.body = ''; this.replyId = ''; this.replyName = ''; this.mentions = []; this.members = [];
      this.writing = false; await this.load(true);
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.writing = false; }
  }
  private async remove(item: RecordComment): Promise<void> {
    if (this.writing || this.loading || !item.canDelete) return;
    this.writing = true; this.errorText = ''; const generation = this.generation;
    try {
      await ApiClient.del<Object>(ApiConfig.getBaseUrl(), `/api/v1/repairs/${this.recordId}/comments/${item.id}`, await this.token());
      if (generation !== this.generation) return;
      this.writing = false; await this.load(true);
    } catch (error) { if (generation === this.generation) this.fail(error); }
    finally { if (generation === this.generation) this.writing = false; }
  }
  @Builder
  comment(item: RecordComment, root: string) {
    Column({ space: 6 }) {
      Text(`${item.author.name} · ${formatOrderTime(item.createdAt)}`).fontSize(12).fontColor('#747A7F')
      Text(item.body).fontSize(14).width('100%')
      if (item.mentions.length > 0) { Text(item.mentions.map((member: CommentMember) => '@' + member.name).join(' ')).fontSize(12).fontColor('#2877D9') }
      Row({ space: 10 }) {
        Button('回复').height(30).fontSize(12).enabled(!this.writing && !this.loading).onClick(() => { this.replyId = root; this.replyName = item.author.name; })
        if (item.canDelete) { Button('删除评论').height(30).fontSize(12).enabled(!this.writing && !this.loading).onClick(() => { this.remove(item); }) }
      }
    }.width('100%').padding(10).backgroundColor('#F5F8FA').borderRadius(10).alignItems(HorizontalAlign.Start)
  }
  build() {
    Column({ space: 10 }) {
      Row() { Text('备案讨论').fontSize(18).fontWeight(FontWeight.Bold).layoutWeight(1); Button('刷新评论').height(32).fontSize(12).enabled(!this.writing && !this.loading).onClick(() => { this.load(true); }) }.width('100%')
      if (this.loading) { Text('评论加载中…').fontSize(12) }
      if (this.errorText !== '') { Text(this.errorText).fontColor('#C34141').fontSize(13); Button('重试读取评论').enabled(!this.writing && !this.loading).onClick(() => { this.load(this.retryReset); }) }
      if (!this.loading && this.items.length === 0 && this.errorText === '') { Text('暂无评论').fontSize(13).fontColor('#747A7F') }
      ForEach(this.items, (item: RecordComment) => {
        Column({ space: 5 }) {
          this.comment(item, item.id)
          ForEach(item.replies, (reply: RecordComment) => { this.comment(reply, item.id); }, (reply: RecordComment) => reply.id)
        }.width('100%')
      }, (item: RecordComment) => item.id)
      if (this.hasMore) { Button('更多评论').enabled(!this.loading && !this.writing).onClick(() => { this.load(false); }) }
      if (this.replyId !== '') { Row() { Text(`回复 ${this.replyName}`).fontSize(13); Button('取消回复').height(30).fontSize(12).enabled(!this.writing).onClick(() => { this.replyId = ''; this.replyName = ''; }) } }
      TextArea({ text: this.body, placeholder: '评论内容，最多 2000 字' }).height(90).maxLength(2000).enabled(!this.writing).onChange((value: string) => { this.body = value; })
      Row({ space: 6 }) {
        TextInput({ text: this.mentionQuery, placeholder: '查找要 @ 的成员' }).layoutWeight(1).enabled(!this.writing).onChange((value: string) => { this.mentionQuery = value; })
        Button(this.searching ? '查找中…' : '查找成员').height(36).fontSize(12).enabled(!this.searching && !this.writing).onClick(() => { this.search(true); })
      }
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.members, (member: MemberDirectoryEntry) => { Button(member.displayName).fontSize(12).height(30).margin(3).backgroundColor(this.mentions.some((item: MemberDirectoryEntry) => item.memberProfileId === member.memberProfileId) ? '#2877D9' : '#9AA9B4').enabled(!this.writing).onClick(() => { this.toggle(member); }) }, (member: MemberDirectoryEntry) => member.memberProfileId)
      }.width('100%')
      if (this.searchMore) { Button('更多成员').height(30).fontSize(12).enabled(!this.searching && !this.writing).onClick(() => { this.search(false); }) }
      if (this.mentions.length > 0) { Text('将提及：' + this.mentions.map((member: MemberDirectoryEntry) => member.displayName).join('、')).fontSize(12).fontColor('#2877D9') }
      Button(this.writing ? '正在提交…' : '发送评论').enabled(!this.writing && !this.loading && this.body.trim() !== '').onClick(() => { this.send(); })
    }.width('100%').padding(14).backgroundColor(Color.White).borderRadius(18).alignItems(HorizontalAlign.Start)
  }
}
