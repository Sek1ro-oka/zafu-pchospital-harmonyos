/** 标题分类只用于浏览过滤，不代表模型诊断或后端已有分类字段。 */
export const GUIDE_CATEGORIES: string[] = ['全部指南', '开机故障', '系统软件', '网络', '磁盘', '散热', '硬件外设', '使用技巧'];

export function guideCategory(title: string): string {
  if (/风扇|散热|清灰|温度|硅脂/.test(title)) return '散热';
  if (/临时桌面|操作系统|软件|驱动|系统/.test(title)) return '系统软件';
  if (/黑屏|开机|启动/.test(title)) return '开机故障';
  if (/认证|网络|校外|校园网|路由/.test(title)) return '网络';
  if (/磁盘|硬盘|文件系统|存储/.test(title)) return '磁盘';
  if (/外设|键盘|鼠标|屏幕|硬件/.test(title)) return '硬件外设';
  return '使用技巧';
}
