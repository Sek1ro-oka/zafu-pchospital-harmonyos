import { HOME_STAFF } from '../../core/auth/AuthContract';
import {
  ROUTE_CASE_DETAIL,
  ROUTE_CASE_LIBRARY,
  ROUTE_KNOWLEDGE,
  ROUTE_KNOWLEDGE_SOURCE,
  ROUTE_REPAIR_ORDERS,
  ROUTE_SERVICE,
  ROUTE_STAFF_ORDER_DETAIL,
  ROUTE_STAFF_ORDERS,
  ROUTE_STAFF_RECORD,
  ROUTE_STAFF_REVIEW
} from '../../core/ui/Routes';
import { SessionHeader } from '../../core/ui/SessionHeader';
import { CARD_GAP, CARD_RADIUS, PAGE_PADDING } from '../../core/ui/Theme';
import { CaseDetailPage } from '../knowledge/CaseDetailPage';
import { CaseLibraryPage } from '../knowledge/CaseLibraryPage';
import { CitationDetailPage } from '../knowledge/CitationDetailPage';
import { CaseDetailParam } from '../knowledge/KnowledgeCaseContract';
import { KnowledgeSourceParam } from '../knowledge/KnowledgeContract';
import { KnowledgePage } from '../knowledge/KnowledgePage';
import { AdminRepairReviewPage } from '../repair/AdminRepairReviewPage';
import { RepairOrdersPage } from '../repair/RepairOrdersPage';
import { StaffRecordParam, StaffOrderParam } from '../repair/StaffRepairContract';
import { StaffRepairOrderDetailPage } from '../repair/StaffRepairOrderDetailPage';
import { StaffRepairOrdersPage } from '../repair/StaffRepairOrdersPage';
import { StaffRepairRecordPage } from '../repair/StaffRepairRecordPage';
import { ServicePage } from '../service/ServicePage';

interface HomeEntry {
  title: string;
  note: string;
  route: string;
}

function customerEntries(): HomeEntry[] {
  return [
    { title: '我的报修', note: '提交报修与查看进度', route: ROUTE_REPAIR_ORDERS },
    { title: '客户服务', note: '预约与常见问题 · 待接入', route: ROUTE_SERVICE },
    { title: '知识问答', note: '有出处的 AI 咨询', route: ROUTE_KNOWLEDGE }
  ];
}

/**
 * 工作人员入口：报修工作台与知识问答必选；
 * 审核入口（业务备案审核，Issue #38）只在服务端下发的权限含 `repair:review` 时展示。
 * 这只是入口可见性，真正的授权仍由服务端逐接口判定。
 */
function staffEntries(permissions: string[]): HomeEntry[] {
  const entries: HomeEntry[] = [
    { title: '报修工作台', note: '待受理队列与我的处理', route: ROUTE_STAFF_ORDERS }
  ];
  if (permissions.includes('repair:review')) {
    entries.push({ title: '备案审核', note: '待审核维修备案 · 通过 / 退回', route: ROUTE_STAFF_REVIEW });
  }
  entries.push({ title: '典型案例库', note: '备案自动整理与知识回流', route: ROUTE_CASE_LIBRARY });
  entries.push({ title: '知识问答', note: '有出处的 AI 咨询', route: ROUTE_KNOWLEDGE });
  return entries;
}

/** 登录后的主页：客户与工作人员共用布局，入口卡片按服务端返回的 home 分流。 */
@Component
export struct HomePage {
  @Prop displayName: string = '';
  @Prop roleText: string = '';
  @Prop home: string = '';
  /** 服务端下发的权限集合（只用于入口可见性，不是授权依据）。 */
  @Prop permissions: string[] = [];
  onLogout: () => Promise<void> = async () => {
  };
  /** 子页面发现会话失效时，通知根页面回登录页。 */
  onSessionExpired: () => void = () => {
  };
  @State pathStack: NavPathStack = new NavPathStack();

  private entries(): HomeEntry[] {
    return this.home === HOME_STAFF ? staffEntries(this.permissions) : customerEntries();
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
  destination(name: string, param: object) {
    if (name === ROUTE_SERVICE) {
      ServicePage();
    } else if (name === ROUTE_REPAIR_ORDERS) {
      RepairOrdersPage({
        onSessionExpired: () => {
          this.onSessionExpired();
        }
      });
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
    } else if (name === ROUTE_STAFF_ORDERS) {
      StaffRepairOrdersPage({
        pathStack: this.pathStack,
        onSessionExpired: () => {
          this.onSessionExpired();
        }
      });
    } else if (name === ROUTE_STAFF_ORDER_DETAIL) {
      StaffRepairOrderDetailPage({
        pathStack: this.pathStack,
        param: param as StaffOrderParam,
        onSessionExpired: () => {
          this.onSessionExpired();
        }
      });
    } else if (name === ROUTE_STAFF_RECORD) {
      StaffRepairRecordPage({
        param: param as StaffRecordParam,
        pathStack: this.pathStack,
        onSessionExpired: () => {
          this.onSessionExpired();
        }
      });
    } else if (name === ROUTE_STAFF_REVIEW) {
      AdminRepairReviewPage({
        pathStack: this.pathStack,
        onSessionExpired: () => {
          this.onSessionExpired();
        }
      });
    } else if (name === ROUTE_CASE_LIBRARY) {
      CaseLibraryPage({
        pathStack: this.pathStack,
        onSessionExpired: (): void => {
          this.expireSession();
        }
      });
    } else if (name === ROUTE_CASE_DETAIL) {
      CaseDetailPage({
        param: param as CaseDetailParam,
        onSessionExpired: (): void => {
          this.expireSession();
        }
      });
    }
  }

  private async expireSession(): Promise<void> {
    this.pathStack.clear();
    await this.onLogout();
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
        Text(this.home === HOME_STAFF
          ? '本轮已接入：真实登录与会话、报修处理与维修备案（受理 / 推进 / 建档 / 审核）、典型案例库（备案标记自动整理）、知识问答（回答带可打开的引用）。'
          : '本轮已接入：真实登录与会话、我的报修（提交与进度查询）、知识问答（回答带可打开的引用）。其余入口仍为骨架页面。')
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
