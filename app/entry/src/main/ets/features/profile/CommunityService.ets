import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { FavoriteItem, MemberFavoriteItem, FavoriteInput, MemberFavoriteInput, CustomerMessageResult, MemberMessageResult,
  MessageResult, MessageItem, CustomerMessage, MemberMessage, PublicCaseItem, PublicCaseDetail } from './CommunityContract';

export class CommunityService {
  private static messageTitle(type: string): string {
    if (type === 'MENTIONED') return '有人提及了你';
    if (type === 'REPAIR_APPROVED') return '维修备案审核通过';
    if (type === 'REPAIR_REJECTED') return '维修备案被退回';
    return '备案有新评论或回复';
  }
  static async memberFavorite(recordId: string): Promise<void> {
    const body: MemberFavoriteInput = { repairRecordId: recordId };
    await ApiClient.post<Object>(ApiConfig.getBaseUrl(), '/api/v1/member/favorites', JSON.stringify(body), await CommunityService.token());
  }
  private static async token(): Promise<string> {
    const token = await SessionStore.readToken();
    if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
    return token;
  }
  static async favorites(staff: boolean, page: number): Promise<FavoriteItem[]> {
    const token = await CommunityService.token(), base = ApiConfig.getBaseUrl();
    if (!staff) return ApiClient.get<FavoriteItem[]>(base, `/api/v1/customer/favorites?page=${page}`, token);
    const items = await ApiClient.get<MemberFavoriteItem[]>(base, `/api/v1/member/favorites?page=${page}`, token);
    return items.map((item: MemberFavoriteItem): FavoriteItem => ({ id: item.id, kind: 'REPAIR', sourceId: item.repairRecordId, title: item.contentExcerpt || item.categoryName || '维修备案', targetId: item.repairRecordId, available: true }));
  }
  static async favorite(kind: string, sourceId: string): Promise<FavoriteItem> {
    const input: FavoriteInput = { kind: kind, sourceId: sourceId };
    return ApiClient.post<FavoriteItem>(ApiConfig.getBaseUrl(), '/api/v1/customer/favorites', JSON.stringify(input), await CommunityService.token());
  }
  static async removeFavorite(staff: boolean, item: FavoriteItem): Promise<void> {
    const id = staff ? item.sourceId : item.id;
    await ApiClient.del<Object>(ApiConfig.getBaseUrl(), `/api/v1/${staff ? 'member' : 'customer'}/favorites/${encodeURIComponent(id)}`, await CommunityService.token());
  }
  static async messages(staff: boolean, page: number): Promise<MessageResult> {
    const token = await CommunityService.token(), base = ApiConfig.getBaseUrl();
    if (staff) {
      const data = await ApiClient.get<MemberMessageResult>(base, `/api/v1/member/notifications?page=${page}`, token);
      return { unreadCount: data.unreadCount, items: data.items.map((item: MemberMessage): MessageItem => ({ id: item.id, title: CommunityService.messageTitle(item.type), body: item.repairExcerpt ?? '', unread: item.status === 'UNREAD', targetId: item.repairRecordId })) };
    }
    const data = await ApiClient.get<CustomerMessageResult>(base, `/api/v1/customer/notifications?page=${page}`, token);
    return { unreadCount: data.unreadCount, items: data.items.map((item: CustomerMessage): MessageItem => ({ id: item.id, title: item.title, body: item.body, unread: item.readAt === null, targetId: item.repairOrderId })) };
  }
  static async messageAction(staff: boolean, action: string, id: string): Promise<void> {
    const prefix = `/api/v1/${staff ? 'member' : 'customer'}/notifications`;
    const token = await CommunityService.token(), base = ApiConfig.getBaseUrl();
    if (action === 'delete') { await ApiClient.del<Object>(base, `${prefix}/${encodeURIComponent(id)}`, token); }
    else { await ApiClient.post<Object>(base, action === 'all' ? `${prefix}/read-all` : `${prefix}/${encodeURIComponent(id)}/read`, '{}', token); }
  }
  static async cases(page: number): Promise<PublicCaseItem[]> {
    return ApiClient.get<PublicCaseItem[]>(ApiConfig.getBaseUrl(), `/api/v1/customer/knowledge-cases?page=${page}`, await CommunityService.token());
  }
  static async caseDetail(id: string): Promise<PublicCaseDetail> {
    return ApiClient.get<PublicCaseDetail>(ApiConfig.getBaseUrl(), `/api/v1/customer/knowledge-cases/${encodeURIComponent(id)}`, await CommunityService.token());
  }
}
