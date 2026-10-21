import type { FilterRule } from "@/lib/api/list-filter";
import type { SortRule } from "@/types/table";

/** Phase 2 public contract constants. Database values and API inputs must use these constants. */
export const UserStatus = ["ACTIVE", "DISABLED"] as const;
export const RoleCode = ["MEMBER", "ADMIN"] as const;
export const MemberStatus = ["ACTIVE", "REVOKED"] as const;
export const IdentityType = ["PHONE", "QQ", "QQ_OAUTH", "WECHAT_OAUTH"] as const;
export const JoinApplicationStatus = [
  "SUBMITTED",
  "INTERVIEW_PENDING",
  "INTERVIEW_PASSED",
  "INTERVIEW_REJECTED",
  "WITHDRAWN",
] as const;
export const InterviewResult = ["PASSED", "REJECTED"] as const;
export const ProvisionStatus = ["NOT_REQUIRED", "PENDING", "SUCCEEDED", "FAILED"] as const;
export const ProvisionSourceType = [
  "JOIN_APPLICATION",
  "INVITE_REDEMPTION",
  "ADMIN_CREATED",
] as const;
export const InviteCodeStoredStatus = ["ACTIVE", "REVOKED"] as const;
export const InviteCodeEffectiveStatus = [
  "NOT_STARTED",
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
  "EXHAUSTED",
] as const;
export const AuditActorType = ["USER", "SYSTEM"] as const;
export const RepairStatus = ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const;
/**
 * 客户报修单的处理状态（Issue #37）。
 *
 * **刻意不复用 `RepairStatus`**：那个是工作人员维修备案的**审核流**
 * （草稿/待审/通过/驳回），本枚举是客户报修的**处理流**（提交/受理/维修中/完成/取消），
 * 两者语义与流转规则都不同。#38 要求「维修处理状态与备案审核状态分别维护」，
 * 分成两个枚举即是该要求的落点。
 */
export const RepairOrderStatus = [
  "SUBMITTED",
  "ACCEPTED",
  "REPAIRING",
  "COMPLETED",
  "CANCELLED",
] as const;
export const RepairResult = ["COMPLETED", "NOT_COMPLETED"] as const;
export const RepairReviewDecision = ["APPROVED", "REJECTED"] as const;
export const RepairTimelineEventType = [
  "CREATED",
  "UPDATED",
  "PHOTO_ADDED",
  "PHOTO_REMOVED",
  "SUBMITTED",
  "RESUBMITTED",
  "APPROVED",
  "REJECTED",
  "DELETED",
  "FLAG_CHANGED",
] as const;
export const NotificationType = [
  "MENTIONED",
  "REPAIR_COMMENTED",
  "REPAIR_APPROVED",
  "REPAIR_REJECTED",
] as const;
export const NotificationStatus = ["UNREAD", "READ"] as const;

type ValueOf<T extends readonly string[]> = T[number];

export type UserStatus = ValueOf<typeof UserStatus>;
export type RoleCode = ValueOf<typeof RoleCode>;
export type MemberStatus = ValueOf<typeof MemberStatus>;
export type IdentityType = ValueOf<typeof IdentityType>;
export type JoinApplicationStatus = ValueOf<typeof JoinApplicationStatus>;
export type InterviewResult = ValueOf<typeof InterviewResult>;
export type ProvisionStatus = ValueOf<typeof ProvisionStatus>;
export type ProvisionSourceType = ValueOf<typeof ProvisionSourceType>;
export type InviteCodeStoredStatus = ValueOf<typeof InviteCodeStoredStatus>;
export type InviteCodeEffectiveStatus = ValueOf<typeof InviteCodeEffectiveStatus>;
export type AuditActorType = ValueOf<typeof AuditActorType>;
export type RepairStatus = ValueOf<typeof RepairStatus>;
export type RepairOrderStatus = ValueOf<typeof RepairOrderStatus>;
export type RepairResult = ValueOf<typeof RepairResult>;
export type RepairReviewDecision = ValueOf<typeof RepairReviewDecision>;
export type RepairTimelineEventType = ValueOf<typeof RepairTimelineEventType>;
export type NotificationType = ValueOf<typeof NotificationType>;
export type NotificationStatus = ValueOf<typeof NotificationStatus>;

/* ------------------------------------------------------------------ M5 统计 */

/** 统计范围。ALL_TIME 不附加任何日期条件。 */
export const AnalyticsScope = ["MONTH", "TERM", "ALL_TIME"] as const;
/** 排行主指标。时长始终以整数分钟入库与比较，小时只在 UI 层格式化。 */
export const RankingMetric = ["REPAIR_COUNT", "DURATION_MINUTES"] as const;
/** 统计可用性。`UNCONFIGURED` 专指学期区间未配置，**不得**解释为 0 或空榜。 */
export const AnalyticsStatus = ["AVAILABLE", "UNCONFIGURED"] as const;

export type AnalyticsScope = ValueOf<typeof AnalyticsScope>;
export type RankingMetric = ValueOf<typeof RankingMetric>;
export type AnalyticsStatus = ValueOf<typeof AnalyticsStatus>;

/* ------------------------------------------------------------------ M6 管理后台 */

/** 导出格式。两者共用同一条数据路径（`RepairExportRow[]`），只在出口处分叉。 */
export const ExportFormat = ["CSV", "XLSX"] as const;
export type ExportFormat = ValueOf<typeof ExportFormat>;

/**
 * 单次导出行数上限。超过即拒绝（`EXPORT_ROW_LIMIT_EXCEEDED`），**不得**静默截断 ——
 * 静默截断会让管理员以为拿到了全量数据。
 */
export const EXPORT_MAX_ROWS = 20000;
/** 批量操作单次上限。逐条调用既有 Service，因此上限也是事务次数的上限。 */
export const ADMIN_BATCH_LIMIT = 50;

/** `GET /api/v1/admin/repairs/export` 的入参：与列表完全相同的筛选，去掉分页。 */
export type RepairExportInput = Omit<RepairListInput, "page" | "pageSize">;

/** 导出行。列顺序即表头顺序，CSV 与 XLSX 共用。 */
export type RepairExportRow = {
  repairDate: string;
  memberName: string;
  categoryName: string;
  result: string;
  durationMinutes: string;
  status: string;
  createdAt: string;
  /** 记录 ID 与照片 URL，按需求「图片不嵌入 Excel，只输出链接或记录 ID」。 */
  repairRecordId: string;
  photoUrls: string;
};

export type RepairExportResult = {
  format: ExportFormat;
  fileName: string;
  contentType: string;
  /**
   * 导出字节流。用 `Uint8Array<ArrayBuffer>` 而不是 Node 的 `Buffer`：
   * 契约文件会被客户端组件间接引用，且 `Response` 的 `BodyInit` 只接受
   * `ArrayBuffer` 支撑的视图（与 `lib/security/secrets.ts` 的 `digest` 同一处理）。
   */
  body: Uint8Array<ArrayBuffer>;
  rowCount: number;
};

export const Permission = [
  "join:submit",
  "join:read",
  "join:review",
  "member:provision",
  "member:manage",
  "invite:create",
  "invite:read",
  "invite:revoke",
  "invite:redeem",
  "audit:read",
  "repair:create",
  "repair:read",
  "repair:update",
  "repair:submit",
  "repair:review",
  "repair:delete",
  "repair:flag",
  "repair:category:manage",
  "member.profile.read_self",
  "member.profile.update_self",
  "member.profile.read_internal",
  "member.skill.assign_self",
  "comment:create",
  "comment:read",
  "comment:delete",
  "favorite:manage",
  "notification:read",
  "analytics:read_internal",
  // M6 管理后台：导出会把成员姓名、学号等写进站外文件，因此单列一个权限码，
  // 不复用 repair:review —— 维修审核与「把数据带出系统」是两件事。
  "data:export",
  // M6 批次 2。
  // `comment:moderate` 不复用 `comment:read`：成员也有 `comment:read`，而管理端评论列表
  // 是**跨记录**的（不过 `assertCanReadRepair`），拿成员权限放行会绕过记录可见性。
  "comment:moderate",
  // 技能标签库与故障分类是两类资源，各自管理；不复用 `member:manage`
  // （那是「给某个成员分配标签」，和「维护标签库本身」不是一件事）。
  "skill:manage",
  // 公开统计展示策略决定官网对外展示什么，与站内管理操作分开。
  "settings:manage",
  // 维修活动：管理 CRUD / 报名管理 vs 成员出勤签到接待。
  "activity:admin",
  "activity:staff",
  // 客户报修单（Issue #37）：与 `repair:*` 是两条独立链路。
  // `repair:*` 是工作人员维修备案；`repair.order:*` 是客户报修申报。
  // 客户没有 MEMBER/ADMIN 角色，靠 customerPermissions 拿到这两个码。
  "repair.order:create",
  "repair.order:read",
  // 选购交易（Issue #84）：二手任何登录用户可发布；耗材属于维修队耗材，
  // 只有授权工作人员能发布/维护；管理员可下架任意商品（原因必填）。
  "shopping.consumable:manage",
  "shopping.product:moderate",
] as const;
export type Permission = ValueOf<typeof Permission>;

export type RequestContext = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};

export type PublicRequestContext = RequestContext;

export type AuthorizedActor = RequestContext & {
  actorType: AuditActorType;
  userId?: string;
  userStatus: UserStatus;
  permissions: readonly Permission[];
  mustChangePassword?: boolean;
};

export type LoginInput = { qq: string; password: string; rememberMe?: boolean };
export type SessionPrincipal = {
  userId: string;
  displayName: string | null;
  roles: RoleCode[];
  permissions: Permission[];
  memberProfileId: string | null;
  memberStatus: MemberStatus | null;
  mustChangePassword: boolean;
};
export type AuthSessionResult = SessionPrincipal & {
  sessionId: string;
  token: string;
  expiresAt: string;
};
export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
  /**
   * 改密轮换后新会话的有效期档位。**省略时保持当前会话的选择**
   * （`AuthService.changePassword` 从库里读原会话的 `rememberMe` 续期）：
   * 绝不允许「没提交这个字段就把 24 小时账号偷偷续成 30 天」。
   */
  rememberMe?: boolean;
};

/**
 * 客户自主注册入参（Issue #60）：只有 QQ + 密码 + 确认密码。
 * 昵称与联系电话留给个人资料（09 模块）补充；这里**不接收**任何角色/权限字段。
 */
export type CustomerRegistrationInput = {
  qq: string;
  password: string;
  passwordConfirmation: string;
  /** 保持登录（30 天）；省略时按普通档位（24 小时）。见 `auth-service.ts` 的 `sessionLifetimeFor`。 */
  rememberMe?: boolean;
};

export type PaginationInput = { page: number; pageSize: number };
export type PaginationMeta = PaginationInput & {
  total: number;
  totalPages: number;
};

export type SubmitJoinApplicationInput = {
  recruitmentCycle: string;
  realName: string;
  qq: string;
  phone: string;
  selfIntroduction?: string;
  preferredDirection?: string;
  applicantRemark?: string;
  privacyConsent: boolean;
};

export type JoinReceipt = {
  id: string;
  ticketNo: string;
  status: JoinApplicationStatus;
  submittedAt: string;
  duplicate: boolean;
};

export type ReviewJoinApplicationInput = {
  applicationId: string;
  result: InterviewResult;
  interviewedAt: string;
  internalNote?: string;
  idempotencyKey: string;
};

export type JoinApplicationView = {
  id: string;
  status: JoinApplicationStatus;
  provisionStatus: ProvisionStatus;
  lastReviewedAt: string | null;
  initializationSecret?: string;
};

export type JoinApplicationListInput = PaginationInput & {
  status?: JoinApplicationStatus;
  provisionStatus?: ProvisionStatus;
  submittedFrom?: string;
  submittedTo?: string;
  query?: string;
};

export type JoinApplicationSummary = JoinApplicationView & {
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  qqMasked: string;
  phoneMasked: string;
  submittedAt: string;
};

export type JoinApplicationDetail = JoinApplicationView & {
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  qq: string;
  phone: string;
  selfIntroduction: string | null;
  preferredDirection: string | null;
  applicantRemark: string | null;
  submittedAt: string;
  reviews: Array<{
    id: string;
    result: string;
    interviewedAt: string;
    internalNote: string | null;
  }>;
};

export type CreateInviteCodeInput = {
  activeFrom?: string | null;
  expiresAt?: string | null;
  maxUses: number;
  boundQq?: string;
  boundPhone?: string;
};

export type UpdateInviteCodeInput = {
  activeFrom?: string | null;
  expiresAt?: string | null;
  maxUses?: number;
};

export type InviteCodeView = {
  id: string;
  displayPrefix: string;
  status: InviteCodeEffectiveStatus;
  activeFrom: string | null;
  expiresAt: string | null;
  maxUses: number;
  usedCount: number;
};

export type CreateInviteCodeResult = InviteCodeView & { plainCode: string };

export type RedeemInviteCodeInput = {
  code: string;
  idempotencyKey: string;
  realName: string;
  qq: string;
  phone: string;
  studentId?: string;
  className?: string;
  password: string;
  /** 保持登录（30 天）；省略时按普通档位（24 小时）。 */
  rememberMe?: boolean;
};

export type ProvisionView = {
  id: string;
  status: ProvisionStatus;
  userId: string | null;
  memberProfileId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
};

export type ProvisionResult = ProvisionView & { initializationSecret?: string };

export type MemberRegistrationResult = {
  userId: string;
  memberProfileId: string;
  redemptionId: string;
  provisionId: string;
};

export type CreateMemberInput = {
  realName: string;
  qq: string;
  phone: string;
  studentId?: string;
  className?: string;
  nickname?: string;
  idempotencyKey: string;
};

export type MemberView = {
  id: string;
  userId: string;
  realName: string;
  nickname: string | null;
  studentId: string | null;
  className: string | null;
  status: MemberStatus;
};
export type MemberMutationResult = { member: MemberView; initializationSecret?: string };

/**
 * 管理端编辑成员后的返回值：{@link MemberView} 之上带**新的 `version`**。
 *
 * 为什么必须带：编辑走乐观锁（`version` 每次成功自增）。就地编辑要能**连续改同一行**，
 * 界面就必须在每次成功后拿到新的版本号 —— 否则第二次提交用的还是旧版本，必然 409。
 *
 * 另一条路是「编辑成功后整表重取」，但那会把无限下翻出来的几页缩回第一页
 * （与拖动排序同一个坑，见 `useAdminList.reorder` 的注释），所以不选它。
 */
export type MemberUpdateView = MemberView & { version: number };

/* --------------------------------------------------- M6 成员管理（管理端） */

/**
 * 管理端成员列表筛选。
 * `query` 只做「姓名 / 昵称 / 学号 / 班级 / 已脱敏 QQ / 手机号」的模糊匹配，
 * **不返回明文联系方式** —— 明文只在成员详情里出现，且读取要写审计。
 */
export type MemberListInput = PaginationInput & {
  query?: string;
  status?: MemberStatus;
  role?: RoleCode;
  /**
   * 排序规则。字段必须落在 `MEMBER_SORTABLE` 白名单内 ——
   * 解析在 `member-http.ts`（`sortRules`，非法值 → `VALIDATION_FAILED`），
   * 映射到列在 `member-sort.ts`（`memberOrderBy`）。
   *
   * 省略或空数组时按服务端默认顺序（新成员在前），**不是**「不排序」：
   * 顺序不确定时，无限下翻的分页会重复或漏行。
   */
  sort?: SortRule[];
  /**
   * 列级筛选条件（`filter=<field>:<op>:<value>`，可重复）。
   * 字段与运算符白名单见 `MEMBER_FILTERABLE`，映射见 `member-filter.ts`。
   *
   * 与 `query` 的区别：`query` 是跨列关键字搜索，这里是**逐列的精确条件**，两者可同时用。
   */
  filters?: FilterRule[];
};

/** 列表条目。QQ 与手机号一律脱敏（`maskQq` / `maskPhone`）。 */
export type MemberListEntry = {
  id: string;
  userId: string;
  realName: string;
  nickname: string | null;
  studentId: string | null;
  className: string | null;
  status: MemberStatus;
  roles: RoleCode[];
  /** 账号是否被停用。`memberProfile.status` 为 `REVOKED` 时用户仍可能保留管理员角色。 */
  userStatus: UserStatus;
  /**
   * 技能标签（第六轮验收：成员表要能直接看到，不必为此打开详情）。
   *
   * 只带展示需要的三个字段，顺序与成员端一致（按标签库的 `sortOrder`）；
   * 完整标签库在 `/api/v1/admin/skills`。**不是敏感信息**，与 QQ / 手机号不同 ——
   * 那两个仍然只在详情接口里给明文。
   */
  skills: MemberSkillTag[];
  qqMasked: string | null;
  phoneMasked: string | null;
  /** 正式统计口径：`APPROVED AND deletedAt IS NULL` 的记录数。 */
  approvedRepairCount: number;
  /** 同一口径的维修总时长（分钟）。列表里与次数同格显示，明细见成员详情的统计。 */
  approvedRepairMinutes: number;
  joinedAt: string;
  version: number;
};

/** 成员身上的一枚技能标签（列表用；`isActive` 为 false 表示该标签已被停用）。 */
export type MemberSkillTag = { id: string; name: string; isActive: boolean };

export type MemberListResult = { items: MemberListEntry[]; pagination: PaginationMeta };

/** 成员详情。管理端**唯一**返回 QQ / 手机号明文的位置，读取必须写审计。 */
export type MemberDetail = MemberListEntry & {
  qq: string | null;
  phone: string | null;
  skills: SkillView[];
};

export type UpdateMemberInput = {
  realName?: string;
  studentId?: string | null;
  className?: string | null;
  nickname?: string | null;
  /** 乐观锁：必须回传列表/详情里拿到的版本号。 */
  version: number;
};

/** 设置角色。必须是角色的**全量集合**，不是增量。 */
export type SetMemberRolesInput = { roles: readonly RoleCode[] };

export type MemberBatchToggleInput = {
  memberIds: readonly string[];
  enabled: boolean;
};

/**
 * 批量结果。逐条调用既有 `setEnabled`，因此**允许部分成功**，
 * 每条失败都带稳定错误码，界面必须逐条展示而不是只报一句“失败”。
 */
export type MemberBatchToggleResult = {
  succeeded: string[];
  failed: { memberId: string; code: string; message: string }[];
};

export type RepairPhotoView = {
  id: string;
  contentUrl: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: string;
};
export type RepairCategoryView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** 管理端分类视图：多一个引用计数，用来回答「能不能停用 / 有没有人用」。 */
export type RepairCategoryAdminView = RepairCategoryView & {
  /** 引用它的未软删除维修记录条数。> 0 说明该分类已有历史数据，只能停用不能物理删除。 */
  usedByRepairCount: number;
  createdAt: string;
};
export type RepairMemberOption = { id: string; name: string };
export type RepairTimelineView = {
  id: string;
  eventType: RepairTimelineEventType;
  summary: unknown;
  actorName: string | null;
  createdAt: string;
};
export type RepairReviewView = {
  id: string;
  decision: RepairReviewDecision;
  note: string | null;
  reviewerName: string | null;
  createdAt: string;
};
export type RepairView = {
  id: string;
  member: { id: string; name: string };
  repairDate: string | null;
  durationMinutes: number | null;
  category: RepairCategoryView | null;
  /** 机型（issue #68）：活动报名时填的选填字段，接待落单时带进记录；手工建单一般为 null。 */
  deviceModel: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  content: string | null;
  result: RepairResult | null;
  remark: string | null;
  status: RepairStatus;
  isDifficult: boolean;
  isTypical: boolean;
  version: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  photos: RepairPhotoView[];
};
export type RepairDetailView = RepairView & {
  reviews: RepairReviewView[];
  timeline: RepairTimelineView[];
  canEdit: boolean;
  canEditDeviceModel: boolean;
  canReview: boolean;
  canFlag: boolean;
  isFavorited: boolean;
  /**
   * 照片上传上限，以服务端 `.env`（`UPLOAD_MAX_BYTES` / `UPLOAD_MAX_FILES_PER_REPAIR`）为准。
   *
   * 随详情一起下发，是为了让前端提前拦下超限文件、并把真实数字写进提示 ——
   * 前端各写一份常量会出现「提示说 10 MB、服务端按 5 MB 拒绝」（issue #68）。
   */
  photoLimits: { maxBytes: number; maxFiles: number };
};
export type RepairDraftFields = {
  deviceModel?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  repairDate?: string | null;
  durationMinutes?: number | null;
  categoryId?: string | null;
  content?: string | null;
  result?: RepairResult | null;
  remark?: string | null;
};
export type CreateRepairDraftInput = RepairDraftFields & { idempotencyKey: string };
export type UpdateRepairInput = RepairDraftFields & { version: number };
export type SubmitRepairInput = { version: number; idempotencyKey: string };
export type ReviewRepairInput = {
  decision: RepairReviewDecision;
  note?: string;
  idempotencyKey: string;
};

/* --------------------------------------------------- M6 维修管理（管理端） */

/**
 * 管理端修改异常数据。
 *
 * 与成员自己的 `UpdateRepairInput` 有三处不同：
 * 1. 允许修改任意状态（含 `APPROVED`）的记录 —— 需求 §36 的「修改异常数据」；
 * 2. `reason` 必填，写入时间线与审计，回答「为什么改」；
 * 3. **不改状态**：管理员改数据不触发重新审核，`APPROVED` 改动后仍是 `APPROVED`。
 *    统计口径始终是「当前值的唯一来源」，不引入快照表，因此历史统计只会随当前值重算，
 *    不会出现两份互相矛盾的数据。改动前后的差异留在 `AuditLog.before/after` 与时间线里。
 */
export type RepairAdminUpdateInput = RepairDraftFields & {
  version: number;
  reason: string;
};

export type RepairBatchReviewInput = {
  recordIds: readonly string[];
  decision: RepairReviewDecision;
  note?: string;
  /** 批量键；逐条派生成 `{key}:{recordId}` 作为各记录自己的幂等键。 */
  idempotencyKey: string;
};

/** 批量审核逐条结果，允许部分成功。 */
export type RepairBatchReviewResult = {
  succeeded: string[];
  failed: { recordId: string; code: string; message: string }[];
};
export type RepairFlagsInput = { isDifficult: boolean; isTypical: boolean };
export type RepairListInput = PaginationInput & {
  memberId?: string;
  categoryId?: string;
  status?: RepairStatus;
  result?: RepairResult;
  repairDateFrom?: string;
  repairDateTo?: string;
  isDifficult?: boolean;
  isTypical?: boolean;
  query?: string;
  /**
   * 排序规则。字段必须落在 `REPAIR_SORTABLE` 白名单内 ——
   * 解析在 `repair-http.ts`（`sortRules`），映射到列在 `repair-sort.ts`（`repairOrderBy`）。
   *
   * 注意：`RepairExportInput` 继承了这个类型（只去掉分页），但**导出不读这个字段** ——
   * 导出的顺序固定按维修日期倒序，不该由界面上的临时排序决定。
   */
  sort?: SortRule[];
};
export type RepairListResult = { items: RepairView[]; pagination: PaginationMeta };
/**
 * 新增故障分类。
 *
 * `code` 与 `sortOrder` 都**改由系统生成**（M6 第三轮验收）：
 * - `code` 是稳定标识，管理员不该为了加一个「散热清灰」去编一个英文 code，
 *   留空时由 `stableCodeFromName` 按名称生成（见 `src/lib/stable-code.ts`）；
 * - `sortOrder` 留空时排到末尾，顺序由列表里的「上移 / 下移」调整
 *   （让用户手填一个 10/20/30 的整数去控制顺序，是把系统的活儿推给人）。
 */
export type CreateRepairCategoryInput = {
  code?: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
};

/** 排序调整方向。一次只挪一格，避免出现「拖到第 3 位」这类需要猜位次的输入。 */
export const ReorderDirection = ["UP", "DOWN"] as const;
export type ReorderDirection = ValueOf<typeof ReorderDirection>;
export type UpdateRepairCategoryInput = {
  name?: string;
  description?: string | null;
  sortOrder?: number;
};

// ---------------------------------------------------------------------------
// M6 批次 2（管理端）：技能标签库 / 评论管理 / 邀请码 / 审计 / 公开统计配置 / 报名导出
// ---------------------------------------------------------------------------

/** 技能标签库管理视图。`usedByMemberCount` 只统计**当前生效**的成员关联，回答「停用会不会影响人」。 */
export type SkillAdminView = SkillView & { usedByMemberCount: number };

/** 技能名称上限（issue #68）：管理端新建与成员自建共用同一条规则，列宽 `VarChar(80)`。 */
export const SKILL_NAME_MAX_LENGTH = 80;

/** 新增技能标签。`code` / `sortOrder` 同 {@link CreateRepairCategoryInput}，由系统生成。 */
export type CreateSkillInput = {
  code?: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
};

export type UpdateSkillInput = {
  name?: string;
  description?: string | null;
  sortOrder?: number;
};

/**
 * 评论管理列表的删除态筛选。
 *
 * 默认只看未删除的；`DELETED` 用来复核「刚才那条是不是真的删掉了」——
 * 软删除后评论仍在库里，界面若完全看不见，管理员无法确认删除结果。
 */
export const CommentModerationFilter = ["ACTIVE", "DELETED", "ALL"] as const;
export type CommentModerationFilter = ValueOf<typeof CommentModerationFilter>;

export type AdminCommentListInput = PaginationInput & {
  query?: string;
  recordId?: string;
  authorMemberProfileId?: string;
  deleted?: CommentModerationFilter;
  createdFrom?: string;
  createdTo?: string;
};

/**
 * 管理端评论条目。
 *
 * 与成员端的 `RepairCommentView` 不同：这里**面向审核**，因此带上所属记录的最小摘要
 * （成员名 / 维修日期 / 审核状态）与回复、提及计数，且**不**返回 `canDelete` 一类
 * 以当前成员视角计算的字段 —— 管理端的动作由权限决定，不由条目字段决定。
 */
export type AdminCommentEntry = {
  id: string;
  body: string;
  author: MemberRef;
  record: {
    id: string;
    memberName: string;
    repairDate: string | null;
    status: RepairStatus;
  };
  parentCommentId: string | null;
  replyCount: number;
  mentionCount: number;
  createdAt: string;
  deletedAt: string | null;
};

export type AdminCommentListResult = {
  items: AdminCommentEntry[];
  pagination: PaginationMeta;
};

/** 邀请码管理列表入参。`status` 是**生效状态**（含派生的过期/用尽），不是存储状态。 */
export type InviteCodeListInput = PaginationInput & {
  status?: InviteCodeEffectiveStatus;
  query?: string;
};

/**
 * 邀请码管理视图。
 *
 * `displayPrefix` 是明文的前 8 位（列表里用于人工核对），**完整明文只在创建响应里出现一次**：
 * 库里只存 `codeDigest`，任何列表都取不回完整邀请码。绑定信息按 PII 规则脱敏。
 */
export type InviteCodeAdminView = InviteCodeView & {
  boundQqMasked: string | null;
  boundPhoneMasked: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type InviteCodeListResult = {
  items: InviteCodeAdminView[];
  pagination: PaginationMeta;
};

export const AuditResult = ["SUCCESS", "FAILURE"] as const;
export type AuditResult = ValueOf<typeof AuditResult>;

export type AuditLogListInput = PaginationInput & {
  action?: string;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  result?: AuditResult;
  createdFrom?: string;
  createdTo?: string;
};

/**
 * 审计条目。
 *
 * `beforeSummary` / `afterSummary` 在**写入时**就已经过 `redactAuditSummary` 脱敏
 * （凭据类字段整条丢弃、QQ / 手机号打码），因此读取时不再二次处理；
 * 也正因如此，「查看审计」本身不再写一条审计 —— 那会变成自我增殖的记录流。
 */
export type AuditLogEntry = {
  id: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  /** 操作者展示名（昵称 / 实名 / 账号名回退）。系统写入为 `null`。 */
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  result: AuditResult;
  errorCode: string | null;
  beforeSummary: unknown;
  afterSummary: unknown;
  createdAt: string;
};

export type AuditLogListResult = {
  items: AuditLogEntry[];
  pagination: PaginationMeta;
};

/** 审计动作筛选项：按出现次数降序，供筛选下拉使用（避免管理员手打动作名）。 */
export type AuditActionOption = {
  action: string;
  count: number;
};

/** 公开排行榜的展示名策略（需求 §33 / §74）。QQ、学号、后台 ID 一律不可公开。 */
export const RankingDisplayNameMode = ["REAL_NAME", "NICKNAME", "HIDDEN"] as const;
export type RankingDisplayNameMode = ValueOf<typeof RankingDisplayNameMode>;

/**
 * 公开内容与展示策略（`/admin/settings`，需求 §31 / §32 / §74）。
 *
 * 单行配置表，**默认全部关闭**：在管理员明确打开之前，官网首页不展示任何真实统计，
 * 不会因为「M7 还没做」而意外把内部数据暴露出去。
 */
export type PublicContentSettings = {
  /** 首页展示累计维修设备数（需求 §31）。 */
  publicRepairStatsEnabled: boolean;
  /** 首页额外展示本学期维修数与累计维修时长（需求 §31 的辅助数据）。 */
  publicRepairStatsDetailEnabled: boolean;
  /** 首页展示简化排行榜（需求 §32）。 */
  publicRankingsEnabled: boolean;
  /** 排行榜展示名：真实姓名 / 仅昵称 / 隐藏（需求 §74）。 */
  rankingDisplayName: RankingDisplayNameMode;
  updatedAt: string | null;
  updatedBy: { userId: string; name: string } | null;
};

export type UpdatePublicContentSettingsInput = {
  publicRepairStatsEnabled: boolean;
  publicRepairStatsDetailEnabled: boolean;
  publicRankingsEnabled: boolean;
  rankingDisplayName: RankingDisplayNameMode;
};

/**
 * 报名数据导出行（需求 §4.4「查看、筛选和导出新成员报名数据」）。
 *
 * 与维修导出分开列模型：报名导出**故意包含 QQ 与手机号明文** —— 招募联系本人需要它，
 * 而需求 §34 对维修导出的要求是可核对的记录 ID，两者口径不同。
 * 因此这条路径使用独立权限与审计动作，不复用 `repair.exported`。
 */
export type JoinApplicationExportRow = {
  ticketNo: string;
  recruitmentCycle: string;
  realName: string;
  qq: string;
  phone: string;
  status: string;
  provisionStatus: string;
  preferredDirection: string;
  submittedAt: string;
  lastReviewedAt: string;
  applicationId: string;
};

export type JoinApplicationExportInput = Omit<JoinApplicationListInput, "page" | "pageSize">;

export type JoinApplicationExportResult = RepairExportResult;

// ---------------------------------------------------------------------------
// M3 成员工作台与个人主页
// ---------------------------------------------------------------------------

/** 指标值。`UNCONFIGURED` 表示口径未配置（如学期区间缺失），此时 `value` 必须为 null，
 *  页面显示「待配置」，绝不回退为伪造的 0。 */
export type MetricStatus = "AVAILABLE" | "UNCONFIGURED";
export type MetricValue = {
  value: number | null;
  status: MetricStatus;
};

export const SkillStatus = ["ACTIVE", "INACTIVE"] as const;
export type SkillStatus = ValueOf<typeof SkillStatus>;

/** 技能标签展示视图。含 code 便于前端按稳定机器码分支，不依赖名称文案。 */
export type SkillView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

/** 成员资料摘要：工作台欢迎区与个人主页共用的最小身份信息。
 *  不含 QQ、学号、班级、userId —— 那些只在受保护的单成员内部详情出现。 */
export type MemberProfileSummary = {
  memberProfileId: string;
  displayName: string;
  nickname: string | null;
  realName: string | null;
  avatarUrl: string | null;
  status: string;
  joinedAt: string;
  roles: RoleCode[];
  skills: SkillView[];
  version: number;
};

/** 自我可见的完整资料（`/member/profile`）。QQ 只在此处出现，且页面标注「内部可见」。 */
export type MemberSelfProfile = MemberProfileSummary & {
  qq: string | null;
  studentId: string | null;
  className: string | null;
  /** 性别等扩展字段留待 M6；此处置空表示不受 M3 管理。 */
  editableFields: readonly ["nickname", "skills"];
};

/** 他人内部主页视图（`/member/profile/[memberProfileId]`）。
 *  比 self 更窄：不含学号、班级、账号状态细节与管理字段。 */
export type MemberInternalProfile = MemberProfileSummary & {
  qq: string | null;
};

export type MemberRecentRepair = {
  id: string;
  repairDate: string | null;
  durationMinutes: number | null;
  categoryName: string | null;
  result: string | null;
  contentExcerpt: string;
  updatedAt: string;
};

/** 工作台「最近操作」条目。可包含未通过记录，因此字段与 `MemberRecentRepair` 区分，
 *  带显式 status，禁止冒充「已通过维修」。 */
export type MemberRecentActivity = {
  id: string;
  status: RepairStatus;
  repairDate: string | null;
  contentExcerpt: string;
  updatedAt: string;
};

export type MemberRepairSummary = {
  totalApprovedCount: MetricValue;
  termApprovedCount: MetricValue;
  monthApprovedCount: MetricValue;
  totalApprovedDurationMinutes: MetricValue;
  /** M5 起正式统计统一来自 Analytics Service；`M2_APPROVED_REPAIRS` 保留为历史兼容值。 */
  source: "M2_APPROVED_REPAIRS" | "M5_ANALYTICS";
  generatedAt: string;
};

export type MemberWorkQueue = {
  draftCount: number;
  pendingCount: number;
  rejectedCount: number;
};

/** M4/M5 尚未接入的中性占位。**禁止**为其编造业务数字。 */
export type DeferredModule = {
  available: false;
  module: "M4" | "M5";
};

/**
 * 工作台中允许独立降级的区块。
 *
 * 四路维修查询相互独立，某一路失败不应导致整页报错（任务书 §12.1
 * 「指标加载用稳定骨架，失败时局部错误」）。失败区块在 `MemberDashboard`
 * 里回退为空数组 / 空队列，并在此字段中列名，供客户端只对该区块渲染错误态。
 */
export type MemberDashboardDegraded =
  | "repairSummary"
  | "workQueue"
  | "recentRepairs"
  | "recentActivity"
  | "notifications"
  | "favorites"
  | "ranking";

export type MemberRef = { id: string; name: string };

export type CommentMentionView = MemberRef;

export type RepairCommentView = {
  id: string;
  body: string;
  author: MemberRef;
  parentCommentId: string | null;
  mentions: CommentMentionView[];
  createdAt: string;
  canDelete: boolean;
  replies: RepairCommentView[];
};

export type CreateRepairCommentInput = {
  body: string;
  parentCommentId?: string | null;
  mentionedMemberProfileIds?: string[];
};

export type RepairCommentListResult = {
  items: RepairCommentView[];
  pagination: PaginationMeta;
};

export type NotificationView = {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  repairRecordId: string | null;
  commentId: string | null;
  actor: MemberRef | null;
  repairExcerpt: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationListInput = PaginationInput & {
  status?: NotificationStatus;
};

export type NotificationListResult = {
  items: NotificationView[];
  unreadCount: number;
  pagination: PaginationMeta;
};

export type FavoriteView = {
  id: string;
  repairRecordId: string;
  repairDate: string | null;
  categoryName: string | null;
  contentExcerpt: string;
  memberName: string;
  isDifficult: boolean;
  isTypical: boolean;
  createdAt: string;
};

export type FavoriteListResult = {
  items: FavoriteView[];
  pagination: PaginationMeta;
};

/**
 * 通知摘要。
 *
 * `available: false` 表示**聚合这一项查询失败**（超时、连接不可用等），
 * 此时 `unreadCount` 必须是 `null` —— **不允许降级成 0**：
 * 「0 条未读」是一个真实的业务结论（确实没有），而「查不出来」是未知，
 * 两者在接口层面必须可分，否则调用方会把失败渲染成「没有新消息」。
 * 与 M3 的 `MetricValue`（宁可标 `UNCONFIGURED` 也不给 0）保持同一口径。
 *
 * `latest` 在失败时为空数组，仅作为结构占位；前端应据 `available` 渲染错误态，
 * 而不是把空数组渲染成「暂无通知」。
 */
export type MemberNotificationSummary =
  | { available: true; unreadCount: number; latest: NotificationView[] }
  | { available: false; unreadCount: null; latest: NotificationView[] };

/** 收藏摘要。失败语义同 {@link MemberNotificationSummary}：`available: false` 时 `count` 为 `null`，不给 0。 */
export type MemberFavoriteSummary =
  | { available: true; count: number; latest: FavoriteView[] }
  | { available: false; count: null; latest: FavoriteView[] };

/* ------------------------------------------------------------------ M5 统计 */

/**
 * 统计范围对应的 UTC 半开区间 `[startInclusive, endExclusive)`。
 * `MONTH` / `TERM` 两端必有值；`ALL_TIME` 无日期条件，两端为 `null`。
 */
export type AnalyticsRange = {
  startInclusive: string | null;
  endExclusive: string | null;
  timezone: "Asia/Shanghai";
};

/** M5 个人正式统计摘要。四个指标字段的含义与 M3 完全一致，只换来源标注。 */
export type MemberAnalyticsSummary = MemberRepairSummary & {
  source: "M5_ANALYTICS";
};

/** 故障分类分布。无分类的历史记录归入稳定桶 `categoryId = null`，不因分类停用而改写。 */
export type CategoryDistributionItem = {
  categoryId: string | null;
  categoryName: string;
  approvedCount: number;
  durationMinutes: number;
};

/** 月度趋势点。`month` 为 `Asia/Shanghai` 自然月的 `YYYY-MM`，缺失月份由 Service 补真实 0。 */
export type MonthlyTrendPoint = {
  month: string;
  approvedCount: number;
  durationMinutes: number;
};

export type MemberAnalytics = {
  summary: MemberAnalyticsSummary;
  categoryDistribution: CategoryDistributionItem[];
  monthlyTrend: MonthlyTrendPoint[];
  generatedAt: string;
};

/**
 * 排行榜条目。
 * **禁止**加入 QQ、手机号、学号、班级或 `userId` —— 这是内部榜单 DTO 的上限。
 */
export type RankingEntry = {
  /** 竞赛排名语义：主指标相同则名次相同，后续名次跳号（10,10,8 → 1,1,3）。 */
  rank: number;
  memberProfileId: string;
  displayName: string;
  avatarUrl: string | null;
  approvedCount: number;
  durationMinutes: number;
  /** 当前主指标的值，等于 `approvedCount` 或 `durationMinutes`。 */
  metricValue: number;
  isCurrentMember: boolean;
};

export type RankingResult = {
  scope: AnalyticsScope;
  metric: RankingMetric;
  status: AnalyticsStatus;
  range: AnalyticsRange;
  items: RankingEntry[];
  /** 「我的排名」不受当前分页影响；零记录时为 `null`。 */
  currentMember: RankingEntry | null;
  pagination: PaginationMeta;
  generatedAt: string;
  source: "M5_ANALYTICS";
};

/**
 * 工作台的本学期数量榜预览。
 *
 * 三种状态必须可区分：
 * - `available: true, status: "AVAILABLE"` —— 正常榜单（可能为空数组，表示确实无人上榜）；
 * - `available: true, status: "UNCONFIGURED"` —— **学期未配置**，`leaders` 为空，
 *   页面显示「待配置」，**不得**伪装成空榜或 0；
 * - `available: false, status: null` —— 该区块**加载失败**，字段置空、并同时出现在
 *   `MemberDashboard.degraded` 中，页面渲染局部错误与重试。
 *   （失败语义与 M4 的 `MemberNotificationSummary` 保持一致，避免用「空榜单」冒充故障。）
 */
export type MemberRankingPreview =
  | {
      available: true;
      status: AnalyticsStatus;
      scope: "TERM";
      metric: "REPAIR_COUNT";
      leaders: RankingEntry[];
      currentMember: RankingEntry | null;
      generatedAt: string;
    }
  | {
      available: false;
      status: null;
      scope: "TERM";
      metric: "REPAIR_COUNT";
      leaders: RankingEntry[];
      currentMember: null;
      generatedAt: string;
    };

export const RANKING_PAGE_SIZE_DEFAULT = 20;
export const RANKING_PAGE_SIZE_MAX = 100;
/** 工作台预览只展示前三名。 */
export const RANKING_PREVIEW_LIMIT = 3;
/** 月度趋势固定 12 个月。 */
export const ANALYTICS_TREND_MONTHS = 12;
/** 无分类历史记录的稳定展示名，与 `categoryId = null` 桶对应。 */
export const UNCATEGORIZED_LABEL = "未分类";

export type RankingQueryInput = PaginationInput & {
  scope: AnalyticsScope;
  metric: RankingMetric;
};

export type MemberDashboard = {
  profile: MemberProfileSummary;
  repairSummary: MemberRepairSummary;
  workQueue: MemberWorkQueue;
  recentRepairs: MemberRecentRepair[];
  recentActivity: MemberRecentActivity[];
  /** 加载失败的区块清单；空数组表示全部成功。 */
  degraded: MemberDashboardDegraded[];
  notifications: MemberNotificationSummary;
  favorites: MemberFavoriteSummary;
  /** M5 起替换 M3 的 `DeferredModule` 占位，返回本学期维修数量榜预览。 */
  ranking: MemberRankingPreview;
};

/** 个人主页（自己）聚合视图：资料 + 技能 + 摘要 + 最近已通过记录。 */
export type MemberSelfProfileView = {
  profile: MemberSelfProfile;
  repairSummary: MemberRepairSummary;
  recentRepairs: MemberRecentRepair[];
};

/** 他人内部主页聚合视图。 */
export type MemberInternalProfileView = {
  profile: MemberInternalProfile;
  repairSummary: MemberRepairSummary;
  recentRepairs: MemberRecentRepair[];
};

export type UpdateMemberProfileInput = {
  nickname?: string | null;
  version: number;
};

export type UpdateMemberProfileResult = {
  profile: MemberSelfProfile;
  version: number;
};

export type UpdateMemberSkillsInput = {
  skillIds: string[];
  profileVersion: number;
};

export type UpdateMemberSkillsResult = {
  skills: SkillView[];
  version: number;
};

export const MEMBER_SKILL_LIMIT = 12;
export const MEMBER_NICKNAME_MAX_LENGTH = 64;
export const MEMBER_RECENT_REPAIR_LIMIT = 5;
export const COMMENT_BODY_MAX_LENGTH = 2000;
export const COMMENT_MENTION_LIMIT = 10;
export const MEMBER_DASHBOARD_NOTIFICATION_LIMIT = 5;
export const MEMBER_DASHBOARD_FAVORITE_LIMIT = 5;

export interface MemberProfileServiceContract {
  getSelf(actor: AuthorizedActor): Promise<MemberSelfProfileView>;
  getInternal(memberProfileId: string, actor: AuthorizedActor): Promise<MemberInternalProfileView>;
  updateProfile(
    input: UpdateMemberProfileInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberProfileResult>;
  updateSkills(
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult>;
}

export interface SkillQueryServiceContract {
  listActive(): Promise<SkillView[]>;
}

export interface MemberDashboardServiceContract {
  getDashboard(actor: AuthorizedActor): Promise<MemberDashboard>;
}

export interface MemberAnalyticsServiceContract {
  /** 本人正式统计：累计/本月/学期/时长 + 分类分布 + 12 个月趋势。 */
  getMemberAnalytics(actor: AuthorizedActor): Promise<MemberAnalytics>;
  /**
   * 管理端指定成员统计（M6「查看成员统计」）。
   *
   * 与被上面的本人版本**口径完全一致**（同一 Repository 函数），唯一区别是
   * 允许显式传入 `memberProfileId`，因此必须单独校验 `analytics:read_internal`，
   * 且**不得**把本人版本改成接受 `memberProfileId` —— 那会让任何成员遍历他人统计。
   */
  getMemberAnalyticsFor(memberProfileId: string, actor: AuthorizedActor): Promise<MemberAnalytics>;
}

/** M6 成员管理（管理端）。与成员自助的 `MemberProfileServiceContract` 分开，避免权限串味。 */
export interface MemberServiceContract {
  create(input: CreateMemberInput, actor: AuthorizedActor): Promise<MemberMutationResult>;
  list(input: MemberListInput, actor: AuthorizedActor): Promise<MemberListResult>;
  getDetail(memberId: string, actor: AuthorizedActor): Promise<MemberDetail>;
  update(
    memberId: string,
    input: UpdateMemberInput,
    actor: AuthorizedActor,
  ): Promise<MemberUpdateView>;
  setEnabled(memberId: string, enabled: boolean, actor: AuthorizedActor): Promise<MemberView>;
  batchSetEnabled(
    input: MemberBatchToggleInput,
    actor: AuthorizedActor,
  ): Promise<MemberBatchToggleResult>;
  resetPassword(memberId: string, actor: AuthorizedActor): Promise<MemberMutationResult>;
  /**
   * 拖动排序：把 `memberIds`（1..50 位，保持它们之间的原有先后）整体挪到 `beforeId` 之前
   * （`null` = 挪到末尾）。落在原位时幂等成功（返回 `false`，不写审计）；任一位成员不存在则 404。
   */
  move(memberIds: string[], beforeId: string | null, actor: AuthorizedActor): Promise<boolean>;
  setRoles(
    memberId: string,
    input: SetMemberRolesInput,
    actor: AuthorizedActor,
  ): Promise<MemberListEntry>;
  setSkills(
    memberId: string,
    input: UpdateMemberSkillsInput,
    actor: AuthorizedActor,
  ): Promise<UpdateMemberSkillsResult>;
}

/** M6 维修管理（管理端审核之外的部分：改数据、软删除、批量审核）。 */
export interface RepairAdminServiceContract {
  updateFlags(
    recordId: string,
    input: RepairFlagsInput,
    actor: AuthorizedActor,
  ): Promise<RepairView>;
  updateRecord(
    recordId: string,
    input: RepairAdminUpdateInput,
    actor: AuthorizedActor,
  ): Promise<RepairView>;
  batchReview(
    input: RepairBatchReviewInput,
    actor: AuthorizedActor,
  ): Promise<RepairBatchReviewResult>;
}

/** M6 数据导出。 */
export interface RepairExportServiceContract {
  export(
    input: RepairExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<RepairExportResult>;
}

export interface RankingServiceContract {
  getRankings(input: RankingQueryInput, actor: AuthorizedActor): Promise<RankingResult>;
  /**
   * 工作台排行预览：固定「本学期 + 维修数量」，取前 {@link RANKING_PREVIEW_LIMIT} 名。
   * 与完整榜单共用同一排名算法，不另写一套逻辑。
   *
   * 与 `getRankings` 一样**必须传 actor 并校验 `analytics:read_internal`** ——
   * 它接受显式 `memberProfileId`，若不校验权限就会成为一条绕过排行权限、
   * 直接读任意成员名次的旁路。
   */
  getTermPreview(memberProfileId: string, actor: AuthorizedActor): Promise<MemberRankingPreview>;
}

export interface JoinApplicationServiceContract {
  list(
    input: JoinApplicationListInput,
    actor: AuthorizedActor,
  ): Promise<{ items: JoinApplicationSummary[]; pagination: PaginationMeta }>;
  get(applicationId: string, actor: AuthorizedActor): Promise<JoinApplicationDetail>;
  submit(input: SubmitJoinApplicationInput, context: PublicRequestContext): Promise<JoinReceipt>;
  review(input: ReviewJoinApplicationInput, actor: AuthorizedActor): Promise<JoinApplicationView>;
  retryProvision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView>;
  provision(applicationId: string, actor: AuthorizedActor): Promise<ProvisionView>;
}

export interface InviteCodeServiceContract {
  list(input: InviteCodeListInput, actor: AuthorizedActor): Promise<InviteCodeListResult>;
  create(input: CreateInviteCodeInput, actor: AuthorizedActor): Promise<CreateInviteCodeResult>;
  update(
    inviteCodeId: string,
    input: UpdateInviteCodeInput,
    actor: AuthorizedActor,
  ): Promise<InviteCodeView>;
  revoke(inviteCodeId: string, actor: AuthorizedActor): Promise<InviteCodeView>;
  redeem(
    input: RedeemInviteCodeInput,
    context: PublicRequestContext,
  ): Promise<MemberRegistrationResult>;
}

export interface SkillAdminServiceContract {
  /** 管理端列表：**含已停用**，并带当前生效的成员关联计数。 */
  list(actor: AuthorizedActor): Promise<SkillAdminView[]>;
  create(input: CreateSkillInput, actor: AuthorizedActor): Promise<SkillView>;
  update(skillId: string, input: UpdateSkillInput, actor: AuthorizedActor): Promise<SkillView>;
  /** 停用 / 启用。技能标签与故障分类同策略：不做物理删除。 */
  setActive(skillId: string, isActive: boolean, actor: AuthorizedActor): Promise<SkillView>;
  /** 上移 / 下移一格。列表顺序对成员侧的标签展示有意义，用按钮比让人填序号可靠。 */
  reorder(skillId: string, direction: ReorderDirection, actor: AuthorizedActor): Promise<void>;
  /**
   * 拖动排序：把 `skillId` 放到 `beforeId` 之前（`null` = 末尾）。
   * 拖动会跨越任意格数，因此一次算出最终顺序、一次写库；与 `reorder` 结果等价。
   */
  move(skillId: string, beforeId: string | null, actor: AuthorizedActor): Promise<void>;
}

export interface CommentAdminServiceContract {
  list(input: AdminCommentListInput, actor: AuthorizedActor): Promise<AdminCommentListResult>;
  softDelete(commentId: string, actor: AuthorizedActor): Promise<void>;
}

export interface AuditLogServiceContract {
  list(input: AuditLogListInput, actor: AuthorizedActor): Promise<AuditLogListResult>;
  listActions(actor: AuthorizedActor): Promise<AuditActionOption[]>;
}

export interface PublicContentSettingsServiceContract {
  get(actor: AuthorizedActor): Promise<PublicContentSettings>;
  update(
    input: UpdatePublicContentSettingsInput,
    actor: AuthorizedActor,
  ): Promise<PublicContentSettings>;
}

export interface JoinApplicationExportServiceContract {
  export(
    input: JoinApplicationExportInput,
    format: ExportFormat,
    actor: AuthorizedActor,
  ): Promise<JoinApplicationExportResult>;
}

export interface AccountProvisionServiceContract {
  provisionFromApplication(applicationId: string, idempotencyKey: string): Promise<ProvisionResult>;
  provisionFromInvite(redemptionId: string, idempotencyKey: string): Promise<ProvisionResult>;
}

export interface RepairServiceContract {
  createDraft(input: CreateRepairDraftInput, actor: AuthorizedActor): Promise<RepairView>;
  update(recordId: string, input: UpdateRepairInput, actor: AuthorizedActor): Promise<RepairView>;
  submit(recordId: string, input: SubmitRepairInput, actor: AuthorizedActor): Promise<RepairView>;
  softDelete(recordId: string, reason: string, actor: AuthorizedActor): Promise<void>;
}
export interface RepairReviewServiceContract {
  review(recordId: string, input: ReviewRepairInput, actor: AuthorizedActor): Promise<RepairView>;
}
export interface RepairQueryServiceContract {
  list(input: RepairListInput, actor: AuthorizedActor): Promise<RepairListResult>;
  getById(recordId: string, actor: AuthorizedActor): Promise<RepairDetailView>;
}

export interface RepairCommentServiceContract {
  list(
    recordId: string,
    input: PaginationInput,
    actor: AuthorizedActor,
  ): Promise<RepairCommentListResult>;
  create(
    recordId: string,
    input: CreateRepairCommentInput,
    actor: AuthorizedActor,
  ): Promise<RepairCommentView>;
  softDelete(recordId: string, commentId: string, actor: AuthorizedActor): Promise<void>;
}

export interface RepairFavoriteServiceContract {
  list(input: PaginationInput, actor: AuthorizedActor): Promise<FavoriteListResult>;
  add(repairRecordId: string, actor: AuthorizedActor): Promise<FavoriteView>;
  remove(repairRecordId: string, actor: AuthorizedActor): Promise<void>;
}

export interface NotificationServiceContract {
  list(input: NotificationListInput, actor: AuthorizedActor): Promise<NotificationListResult>;
  markRead(notificationId: string, actor: AuthorizedActor): Promise<NotificationView>;
  markAllRead(actor: AuthorizedActor): Promise<{ updatedCount: number }>;
  softDelete(notificationId: string, actor: AuthorizedActor): Promise<void>;
}
