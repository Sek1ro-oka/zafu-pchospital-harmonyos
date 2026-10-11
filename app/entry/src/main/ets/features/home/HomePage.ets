import { HOME_STAFF } from '../../core/auth/AuthContract';
import { NavPusher, routeTitle, ROUTE_KNOWLEDGE, ROUTE_KNOWLEDGE_SOURCE, ROUTE_REPAIR, ROUTE_REPAIR_ORDERS, ROUTE_SERVICE } from '../../core/ui/Routes';
import { EntryCard } from '../../core/ui/EntryCard';
import { SessionHeader } from '../../core/ui/SessionHeader';
import {
  FONT_HEADING,
  FONT_NOTE,
  FONT_TITLE,
  GAP_LG,
  PAGE_PADDING,
} from '../../core/ui/Theme';
import { CitationDetailPage } from '../knowledge/CitationDetailPage';
import { KnowledgeSourceParam } from '../knowledge/KnowledgeContract';
import { KnowledgePage } from '../knowledge/KnowledgePage';
import { RepairOrdersPage } from '../repair/RepairOrdersPage';
import { RepairPage } from '../repair/RepairPage';
import { ServicePage } from '../service/ServicePage';

interface HomeEntry {
  title: string;
  note: string;
  route: string;
  /** 图标砖上的单字（工程无图标资源，见 Theme.ets 的图标风格约定）。 */
  icon: string;
  /** false = 业务未接入：图标砖用灰底，点击仍进入如实标注"未接入"的骨架页。 */
  ready: boolean;
}

function customerEntries(): HomeEntry[] {
  return [
    { title: '我的报修', note: '提交报修与查看进度', route: ROUTE_REPAIR_ORDERS, icon: '修', ready: true },
    { title: '知识问答', note: '有出处的 AI 咨询', route: ROUTE_KNOWLEDGE, icon: '问', ready: true },
    { title: '客户服务', note: '设备与服务入口 · 部分待接入', route: ROUTE_SERVICE, icon: '服', ready: true }
  ];
}

function staffEntries(): HomeEntry[] {
  return [
    { title: '待受理报修', note: '客户新报修列表 · 待接入', route: ROUTE_REPAIR, icon: '单', ready: false },
    { title: '维修备案', note: '维修记录与提交审核 · 待接入', route: ROUTE_REPAIR, icon: '案', ready: false },
    { title: '案例审核', note: '故障卡审核与发布 · 待接入', route: ROUTE_REPAIR, icon: '审', ready: false },
    { title: '知识问答', note: '有出处的 AI 咨询', route: ROUTE_KNOWLEDGE, icon: '问', ready: true }
  ];
}

/**
 * 登录后的主页：客户与工作人员共用布局，入口卡片按服务端返回的 home 分流。
 *
 * 布局对照 docs/reference/my-huawei/service-my-products-repair-entry.jpg：
 * 浅底 + 白卡网格，图标砖在左、标题与说明在右（EntryCard 共用组件）。
 * 首页是客户主入口，聚合已接入的报修与问答；子页统一由 NavDestination
 * 提供标题栏与返回按钮，系统返回手势只弹栈，会话状态保留在本页不丢失。
 */
@Component
export struct HomePage {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  onLogout: () => Promise<void> = async () => {
  };
  /** 子页面发现会话失效时，通知根页面回登录页。 */
  onSessionExpired: () => void = () => {
  };
  @State pathStack: NavPathStack = new NavPathStack();
  /** 统一跳转入口：带防抖，快速双击入口卡片不会把同一页面压栈两次。 */
  private pusher: NavPusher = new NavPusher();

  private entries(): HomeEntry[] {
    return this.home === HOME_STAFF ? staffEntries() : customerEntries();
  }

  /** 会话失效的统一出口：清空导航栈再回登录页，避免栈底残留子页。 */
  private async expireSession(): Promise<void> {
    this.pathStack.clear();
    await this.onLogout();
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(FONT_HEADING)
      .fontWeight(FontWeight.Bold)
      .fontColor($r('app.color.text_primary'))
      .width('100%')
      .textAlign(TextAlign.Start)
  }

  @Builder
  destination(name: string, param: object) {
    NavDestination() {
      if (name === ROUTE_SERVICE) {
        ServicePage({ pathStack: this.pathStack });
      } else if (name === ROUTE_REPAIR_ORDERS) {
        RepairOrdersPage({
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_REPAIR) {
        RepairPage();
      } else if (name === ROUTE_KNOWLEDGE) {
        KnowledgePage({
          pathStack: this.pathStack,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      } else if (name === ROUTE_KNOWLEDGE_SOURCE) {
        CitationDetailPage({
          param: param as KnowledgeSourceParam,
          onSessionExpired: (): void => {
            this.expireSession();
          }
        });
      }
    }
    .title(routeTitle(name))
    .backgroundColor($r('app.color.start_window_background'))
  }

  build() {
    Navigation(this.pathStack) {
      Column({ space: GAP_LG }) {
        Text('电脑医院')
          .fontSize(FONT_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.text_primary'))
          .width('100%')
          .textAlign(TextAlign.Start)
        SessionHeader({
          displayName: this.displayName,
          roleText: this.roleText,
          onLogout: this.onLogout
        })
        this.sectionTitle(this.home === HOME_STAFF ? '工作台入口' : '常用功能')
        Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
          ForEach(this.entries(), (entry: HomeEntry) => {
            EntryCard({
              icon: entry.icon,
              title: entry.title,
              note: entry.note,
              ready: entry.ready,
              onSelect: (): void => {
                this.pusher.push(this.pathStack, entry.route, null);
              }
            });
          }, (entry: HomeEntry) => entry.title + entry.route)
        }
        .width('100%')
        Text(this.home === HOME_STAFF
          ? '已接入：真实登录与会话、知识问答（回答带可打开的引用）。工作台各入口仍为骨架页面，未接入业务数据。'
          : '已接入：真实登录与会话、我的报修（提交与进度查询）、知识问答（回答带可打开的引用）。客户服务页中未标注「已接入」的入口为骨架，未接入业务数据。')
          .fontSize(FONT_NOTE)
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
    .hideTitleBar(true)
    .navDestination(this.destination)
  }
}
