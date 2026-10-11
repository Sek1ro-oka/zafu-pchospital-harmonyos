/**
 * 全局设计令牌（Issue #41 布局统一）。
 *
 * 视觉规范来自 docs/reference/my-huawei/ 五张参考截图的落地提炼：
 * - 配色层级：浅蓝灰页面底色（start_window_background）→ 白色卡片（surface）→
 *   品牌蓝点缀（brand / brand_soft）。颜色令牌统一放
 *   resources/base/element/color.json（$r 引用），本文件只放数值型令牌。
 * - 卡片圆角与阴影：参考图为白卡 + 大圆角、**无重阴影**，卡片层级靠底色对比表达，
 *   因此这里不引入阴影令牌，页面也不要给卡片加 shadow。
 * - 间距栅格：页面留白 20 / 分区间 24 / 卡片间 12 / 卡片内 16，微间距 4 与 8。
 * - 字号层级：应用名 30 → 页面标题 26 → 分区标题 20 → 卡片标题 16 →
 *   正文 15 → 次要文字 14 → 注释 13 → 标签 12。
 * - 图标风格：工程无 UI 图标资源，统一用「圆角色块 + 单字」图标砖
 *   （ICON_TILE）。配色为本轮重设计扩展的多彩图标砖系统：每个功能有
 *   柔和底色 + 前景色对（color.json 的 tile_*_bg / tile_*_fg，橙/绿/蓝/
 *   紫/青/红/金七对），由 core/ui/IconTile.ets 按 hue 键渲染；
 *   未接入的能力沿用 field_bg/text_secondary 灰砖如实弱化。
 */

// ===== 间距栅格 =====
/** 页面四周留白。 */
export const PAGE_PADDING: number = 20;
/** 分区与分区之间的留白（如"常用服务"与"服务记录"两段之间）。 */
export const GAP_SECTION: number = 24;
/** 页面根布局、区块之间的间距。 */
export const GAP_LG: number = 16;
/** 卡片与卡片之间的间距（网格 gap、卡片内分组间距）。 */
export const CARD_GAP: number = 12;
/** 卡片内行/列的微间距（图标与文字、标签与说明）。 */
export const GAP_SM: number = 8;
/** 引用正文等极紧的微间距。 */
export const GAP_XS: number = 4;

// ===== 卡片内边距 =====
/** 常规卡片内边距。 */
export const CARD_PADDING: number = 16;
/** 气泡、引用卡等紧凑卡片的内边距。 */
export const CARD_PADDING_SM: number = 12;
/** 空态 / 错误面板等宽松内边距。 */
export const CARD_PADDING_LG: number = 32;

// ===== 圆角 =====
/** 卡片圆角。 */
export const CARD_RADIUS: number = 16;
/** 按钮、输入框与卡片内嵌套块的圆角。 */
export const CONTROL_RADIUS: number = 12;
/** 状态标签（chip）圆角。 */
export const CHIP_RADIUS: number = 8;

// ===== 底部 Tab 栏（本轮重设计新增） =====
/** 悬浮胶囊 Tab 栏高度。 */
export const TAB_BAR_HEIGHT: number = 60;
/** 悬浮胶囊 Tab 栏的圆角（高度的一半，正胶囊）。 */
export const TAB_BAR_RADIUS: number = 30;
/** Tab 栏距屏幕左右与底部的悬浮边距。 */
export const TAB_BAR_MARGIN: number = 12;
/** 三个 tab 页根布局的底部额外内边距：给悬浮 Tab 栏让位（栏高 + 上下悬浮边距）。 */
export const TAB_PAGE_BOTTOM_INSET: number = TAB_BAR_HEIGHT + TAB_BAR_MARGIN * 2;
/** Tab 栏单个图标字的尺寸（不用图标砖底色的裸字样式）。 */
export const TAB_ICON_SIZE: number = 24;

// ===== 控件尺寸 =====
/** 主控件高度（登录/提交按钮、输入框）。 */
export const CONTROL_HEIGHT: number = 48;
/** 次级按钮高度（保存地址、加载更多）。 */
export const CONTROL_HEIGHT_MD: number = 40;
/** 轻量按钮高度（退出、重试、清空）。 */
export const CONTROL_HEIGHT_SM: number = 36;
/** 图标砖边长（色块 + 单字，见文件头"图标风格"）。 */
export const ICON_TILE: number = 44;

// ===== 字号层级 =====
/** 应用名（登录页、启动页）。 */
export const FONT_DISPLAY: number = 30;
/** 页面主标题（首页问候、各子页 NavDestination 标题随系统样式）。 */
export const FONT_TITLE: number = 26;
/** 分区标题、卡片内大标题（如"提交报修""进度"）。 */
export const FONT_HEADING: number = 20;
/** 卡片标题、主按钮文字。 */
export const FONT_SUBTITLE: number = 16;
/** 正文（消息气泡、表单值、正文内容）。 */
export const FONT_BODY: number = 15;
/** 表单标签、次要说明文字。 */
export const FONT_TEXT: number = 14;
/** 辅助注释、空态说明。 */
export const FONT_NOTE: number = 13;
/** 标签、角标、时间戳。 */
export const FONT_CHIP: number = 12;
