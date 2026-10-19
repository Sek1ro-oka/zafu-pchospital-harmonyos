/** #83 离线演示数据；不是业务结果或实际用户。 */
export interface DemoGuide { id: string; category: string; title: string; body: string; }
export const CATEGORIES: string[] = ['全部', '开机', '系统', '网络', '散热'];
export const GUIDES: DemoGuide[] = [
  { id: 'demo-boot', category: '开机', title: '开机无响应：记录现象', body: '这是导航演示样本，不是设备诊断。示例内容展示指南阅读结构。正式页面将显示知识库正文、来源及可见性；不要依据本样本拆机。' },
  { id: 'demo-network', category: '网络', title: '校园网络连接问题', body: '这是自编演示样本。示例记录项：发生时间、网络名称与提示信息。本页没有访问真实知识或模型。' },
  { id: 'demo-heat', category: '散热', title: '发热与风扇现象记录', body: '这是自编演示样本，不代表维修结论。指南、有效案例与内部维修备案保持独立，公开阅读不能获得内部权限。' }
];
export function searchGuides(category: string, query: string): DemoGuide[] {
  return GUIDES.filter((g: DemoGuide): boolean => (category === '全部' || g.category === category) && g.title.includes(query.trim()));
}
export const PERSONAL: string[] = ['个人资料', '我的报修', '我的报名', '我的收藏', '站内消息', '购物订单', '卖家订单', '我的商品', '我的帖子'];
export function futureModule(title: string): string {
  if (['选购待接入', '发布二手商品', '购物订单', '卖家订单', '我的商品', '我发布的商品'].includes(title)) return '选购功能建设中，暂无法下单';
  if (title === '我的帖子') return '论坛功能建设中';
  return '演示版尚未接入此服务';
}
