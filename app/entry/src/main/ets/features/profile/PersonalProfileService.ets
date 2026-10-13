import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { SessionStore } from '../../core/auth/SessionStore';
import { CustomerProfileView, CustomerProfileUpdate, MemberProfileResult, MemberProfileUpdate,
  SkillView, MemberSkillsUpdate, MemberSkillsResult, MemberDirectoryResult } from './PersonalProfileContract';

export class PersonalProfileService {
  private static async token(): Promise<string> {
    const token = await SessionStore.readToken();
    if (token === '') throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
    return token;
  }
  static async customer(): Promise<CustomerProfileView> {
    return ApiClient.get<CustomerProfileView>(ApiConfig.getBaseUrl(), '/api/v1/customer/profile', await PersonalProfileService.token());
  }
  static async saveCustomer(input: CustomerProfileUpdate): Promise<CustomerProfileView> {
    return ApiClient.post<CustomerProfileView>(ApiConfig.getBaseUrl(), '/api/v1/customer/profile', JSON.stringify(input), await PersonalProfileService.token());
  }
  static async member(id: string = ''): Promise<MemberProfileResult> {
    const path = id === '' ? '/api/v1/member/profile' : `/api/v1/members/${encodeURIComponent(id)}/profile`;
    return ApiClient.get<MemberProfileResult>(ApiConfig.getBaseUrl(), path, await PersonalProfileService.token());
  }
  static async saveMember(input: MemberProfileUpdate): Promise<MemberProfileResult> {
    return ApiClient.post<MemberProfileResult>(ApiConfig.getBaseUrl(), '/api/v1/member/profile', JSON.stringify(input), await PersonalProfileService.token());
  }
  static async skills(): Promise<SkillView[]> {
    return ApiClient.get<SkillView[]>(ApiConfig.getBaseUrl(), '/api/v1/skills', await PersonalProfileService.token());
  }
  static async saveSkills(input: MemberSkillsUpdate): Promise<MemberSkillsResult> {
    return ApiClient.post<MemberSkillsResult>(ApiConfig.getBaseUrl(), '/api/v1/member/profile/skills', JSON.stringify(input), await PersonalProfileService.token());
  }
  static async directory(query: string, page: number): Promise<MemberDirectoryResult> {
    return ApiClient.get<MemberDirectoryResult>(ApiConfig.getBaseUrl(), `/api/v1/member/directory?query=${encodeURIComponent(query)}&page=${page}`, await PersonalProfileService.token());
  }
}
