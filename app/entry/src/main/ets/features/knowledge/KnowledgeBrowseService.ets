import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { BrowseGuide, BrowseGuideList, BrowseCasePage } from './KnowledgeBrowse';

export class KnowledgeBrowseService {
  static async guides(): Promise<BrowseGuide[]> {
    const data = await ApiClient.get<BrowseGuideList>(ApiConfig.getBaseUrl(), '/api/v1/public/knowledge/guides', '');
    return data.guides;
  }
  static async cases(query: string, page: number, caseId: string = ''): Promise<BrowseCasePage> {
    const token = await SessionStore.readToken();
    if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
    return ApiClient.get<BrowseCasePage>(ApiConfig.getBaseUrl(),
      `/api/v1/knowledge/cases/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=20${caseId === '' ? '' : '&caseId=' + encodeURIComponent(caseId)}`, token);
  }
}
