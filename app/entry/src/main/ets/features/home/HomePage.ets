import { HOME_STAFF } from '../../core/auth/AuthContract';
import { ROUTE_KNOWLEDGE, ROUTE_REPAIR, ROUTE_SERVICE } from '../../core/ui/Routes';
import { SessionHeader } from '../../core/ui/SessionHeader';
import { CARD_GAP, CARD_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { KnowledgePage } from '../knowledge/KnowledgePage';
import { RepairPage } from '../repair/RepairPage';
import { ServicePage } from '../service/ServicePage';

interface HomeEntry {
  title: string;
  note: string;
  route: string;
}

function customerEntries(): HomeEntry[] {
  return [
    { title: '客户服务', note: '报修与进度查询 · 待接入', route: ROUTE_SERVICE },
    { title: '知识问答', note: '有出处的 AI 咨询 · 待接入', route: ROUTE_KNOWLEDGE }
  ];
}

function staffEntries(): HomeEntry[] {
  return [
    { title: '待受理报修', note: '客户新报修列表 · 待接入', route: ROUTE_REPAIR },
    { title: '维修备案', note: '维修记录与提交审核 · 待接入', route: ROUTE_REPAIR },
    { title: '案例审核', note: '故障卡审核与发布 · 待接入', route: ROUTE_REPAIR },
    { title: '知识问答', note: '有出处的 AI 咨询 · 待接入', route: ROUTE_KNOWLEDGE }
  ];
}

/** 登录后的主页：客户与工作人员共用布局，入口卡片按服务端返回的 home 分流。 */
@Component
export struct HomePage {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  onLogout: () => Promise<void> = async () => {
  };
  @State pathStack: NavPathStack = new NavPathStack();

  private entries(): HomeEntry[] {
    return this.home === HOME_STAFF ? staffEntries() : customerEntries();
  }

  @Builder
  entryCard(entry: HomeEntry) {
    Column({ space: 6 }) {
      Text(entry.title)
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor($r('app.color.text_primary'))
      Text(entry.note)
        .fontSize(13)
        .fontColor($r('app.color.text_secondary'))
    }
    .width('48%')
    .padding(16)
    .margin({ bottom: CARD_GAP })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor($r('app.color.surface'))
    .borderRadius(CARD_RADIUS)
    .onClick(() => {
      this.pathStack.pushPathByName(entry.route, null);
    })
  }

  @Builder
  destination(name: string) {
    if (name === ROUTE_SERVICE) {
      ServicePage();
    } else if (name === ROUTE_REPAIR) {
      RepairPage();
    } else if (name === ROUTE_KNOWLEDGE) {
      KnowledgePage();
    }
  }

  build() {
    Navigation(this.pathStack) {
      Column({ space: 16 }) {
        SessionHeader({
          displayName: this.displayName,
          roleText: this.roleText,
          onLogout: this.onLogout
        })
        Text(this.home === HOME_STAFF ? '工作人员工作台' : '客户服务')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.entries(), (entry: HomeEntry) => {
            this.entryCard(entry);
          }, (entry: HomeEntry) => entry.title + entry.route)
        }
        .width('100%')
        Text('本轮已接入：真实登录与会话。上方业务入口仍为骨架页面，未接入数据。')
          .fontSize(13)
          .fontColor($r('app.color.text_secondary'))
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      .width('100%')
      .height('100%')
      .padding(PAGE_PADDING)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor($r('app.color.start_window_background'))
    }
    .title('电脑医院')
    .navDestination(this.destination)
  }
}
