import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ApiRequestError, isSessionExpiredCode } from '../../core/network/ApiClient';
import { LoadingPanel, ErrorPanel } from '../../core/ui/StatePanel';
import { REFERENCE_BACKGROUND } from '../../core/ui/ReferencePage';
import { ROUTE_MEMBER_DIRECTORY } from '../../core/ui/Routes';
import { CustomerProfileUpdate, MemberProfileUpdate, MemberSkillsUpdate, SkillView, PersonalProfileParam } from './PersonalProfileContract';
import { PersonalProfileService } from './PersonalProfileService';

@Component
export struct PersonalProfilePage {
  @Prop home: string = '';
  @Prop permissions: string[] = [];
  param: PersonalProfileParam | null = null;
  onSaved: (name: string) => void = () => {};
  onSessionExpired: () => void = () => {};
  onOpen: (route: string, param: Object | null) => void = () => {};
  @State loading: boolean = false;
  @State ready: boolean = false;
  @State saving: boolean = false;
  @State errorText: string = '';
  @State notice: string = '';
  @State nickname: string = '';
  @State phone: string = '';
  @State name: string = '';
  @State realName: string = '';
  @State qq: string = '';
  @State studentId: string = '';
  @State className: string = '';
  @State version: number = 0;
  @State skills: SkillView[] = [];
  @State selected: string[] = [];
  private generation: number = 0;

  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void {
    this.generation += 1;
    // 旧请求不再拥有页面的忙状态；其迟到响应仍由 generation 拦截。
    this.loading = false; this.saving = false; this.ready = false;
  }
  private internal(): boolean { return this.param !== null && this.param.memberProfileId !== ''; }
  private editable(): boolean { return !this.internal() && (this.home !== HOME_STAFF || this.permissions.includes('member.profile.update_self')); }
  private handleError(error: Object): void {
    if (error instanceof ApiRequestError) {
      if (isSessionExpiredCode(error.code)) { this.onSessionExpired(); return; }
      this.errorText = error.message;
    } else { this.errorText = '请求失败，请重试'; }
  }
  private async load(): Promise<void> {
    if (this.loading || this.saving) return;
    this.loading = true;
    this.ready = false;
    this.errorText = '';
    this.notice = '';
    const generation = ++this.generation;
    try {
      if (this.home === HOME_STAFF || this.internal()) {
        const result = await PersonalProfileService.member(this.param?.memberProfileId ?? '');
        if (generation !== this.generation) return;
        const choices = this.internal() ? [] : await PersonalProfileService.skills();
        if (generation !== this.generation) return;
        const profile = result.profile;
        this.name = profile.displayName; this.nickname = profile.nickname ?? '';
        this.version = profile.version; this.realName = profile.realName ?? '';
        this.qq = profile.qq ?? ''; this.studentId = profile.studentId ?? ''; this.className = profile.className ?? '';
        this.selected = profile.skills.map((skill: SkillView) => skill.id);
        this.skills = choices.concat(profile.skills.filter((skill: SkillView) => !choices.some((item: SkillView) => item.id === skill.id)));
      } else {
        const profile = await PersonalProfileService.customer();
        if (generation !== this.generation) return;
        this.name = profile.displayName; this.nickname = profile.nickname ?? '';
        this.phone = profile.phone ?? ''; this.version = profile.version;
      }
      this.ready = true;
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async saveNickname(): Promise<void> {
    if (this.saving || this.loading || !this.ready || !this.editable()) return;
    this.saving = true; this.errorText = ''; this.notice = '';
    const generation = this.generation;
    try {
      if (this.home === HOME_STAFF) {
        const input: MemberProfileUpdate = { nickname: this.nickname.trim() || null, version: this.version };
        const result = await PersonalProfileService.saveMember(input);
        if (generation !== this.generation) return;
        this.version = result.profile.version; this.name = result.profile.displayName;
        this.nickname = result.profile.nickname ?? '';
      } else {
        const input: CustomerProfileUpdate = { nickname: this.nickname.trim() || null, phone: this.phone.trim() || null, version: this.version };
        const result = await PersonalProfileService.saveCustomer(input);
        if (generation !== this.generation) return;
        this.version = result.version; this.name = result.displayName;
        this.nickname = result.nickname ?? ''; this.phone = result.phone ?? '';
      }
      this.onSaved(this.name); this.notice = '资料已保存';
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.saving = false; }
  }
  private toggleSkill(skill: SkillView): void {
    if (this.saving || this.loading || this.internal() || !this.permissions.includes('member.skill.assign_self')) return;
    if (this.selected.includes(skill.id)) { this.selected = this.selected.filter((id: string) => id !== skill.id); }
    else if (skill.isActive && this.selected.length < 12) { this.selected = this.selected.concat([skill.id]); }
  }
  private async saveSkills(): Promise<void> {
    if (this.saving || this.loading || !this.ready || this.internal() || !this.permissions.includes('member.skill.assign_self')) return;
    this.saving = true; this.errorText = ''; this.notice = '';
    const generation = this.generation;
    try {
      const input: MemberSkillsUpdate = { skillIds: this.selected.slice(), profileVersion: this.version };
      const result = await PersonalProfileService.saveSkills(input);
      if (generation !== this.generation) return;
      this.version = result.version; this.selected = result.skills.map((skill: SkillView) => skill.id);
      this.notice = '技能已保存';
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.saving = false; }
  }

  @Builder
  field(label: string, value: string) {
    Row() { Text(label).fontSize(14).fontColor('#737A80').width(100); Text(value || '未填写').fontSize(15).layoutWeight(1) }.width('100%')
  }
  build() {
    Scroll() {
      Column({ space: 16 }) {
        if (this.loading) { LoadingPanel({ text: '正在读取资料…' }) }
        if (this.errorText !== '') {
          ErrorPanel({ message: this.errorText, onRetry: (): void => { this.load(); } })
        }
        if (this.ready && !this.loading) {
          Column({ space: 16 }) {
            Row({ space: 12 }) {
              Image($r('app.media.profile_avatar')).width(56).height(56).borderRadius(28)
              Text(this.name).fontSize(22).fontWeight(FontWeight.Bold).layoutWeight(1)
            }.width('100%')
            if (this.editable()) {
              Text('昵称（最多 64 字；清空后使用默认名称）').fontSize(13).fontColor('#737A80').width('100%')
              TextInput({ text: this.nickname, placeholder: '请输入昵称' }).enabled(!this.saving).onChange((value: string) => { this.nickname = value; })
              if (this.home !== HOME_STAFF) {
                TextInput({ text: this.phone, placeholder: '联系电话（可清空）' }).type(InputType.PhoneNumber).enabled(!this.saving).onChange((value: string) => { this.phone = value; })
                Text('修改资料不会改写已提交报修或报名的联系信息。').fontSize(12).fontColor('#737A80')
              }
              Button(this.saving ? '保存中…' : '保存资料').enabled(!this.saving).width('100%').onClick(() => { this.saveNickname(); })
            }
            if (this.home === HOME_STAFF || this.internal()) {
              this.field('真实姓名', this.realName)
              this.field('QQ（内部可见）', this.qq)
              if (!this.internal()) { this.field('学号', this.studentId); this.field('班级', this.className) }
              Text(this.internal() ? '成员技能' : '选择技能（最多 12 项）').fontSize(16).width('100%')
              if (this.skills.length === 0) { Text('暂无技能标签').fontSize(14).fontColor('#737A80') }
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.skills, (skill: SkillView) => {
                  Text(`${this.selected.includes(skill.id) ? '✓ ' : ''}${skill.name}${skill.isActive ? '' : '（停用）'}`)
                    .fontSize(14).padding(10).margin(4).borderRadius(12)
                    .backgroundColor(this.selected.includes(skill.id) ? '#DDEBFF' : '#F3F5F7')
                    .onClick(() => { this.toggleSkill(skill); })
                }, (skill: SkillView) => skill.id)
              }.width('100%')
              if (!this.internal() && this.permissions.includes('member.skill.assign_self')) {
                Button('保存技能').enabled(!this.saving).width('100%').onClick(() => { this.saveSkills(); })
              }
            }
            if (this.notice !== '') { Text(this.notice).fontColor('#288050') }
          }.width('100%').padding(20).backgroundColor(Color.White).borderRadius(20)
        }
        Button('刷新资料').enabled(!this.loading && !this.saving).onClick(() => { this.load(); })
        if (this.permissions.includes('member.profile.read_internal')) {
          Button('查看成员资料').onClick(() => { this.onOpen(ROUTE_MEMBER_DIRECTORY, null); })
        }
      }.width('100%').padding(16)
    }.width('100%').height('100%').align(Alignment.Top).backgroundColor(REFERENCE_BACKGROUND)
  }
}
