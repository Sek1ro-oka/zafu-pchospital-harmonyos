import { ApiClient, ApiRequestError } from '../../core/network/ApiClient';
import { ApiConfig } from '../../core/network/ApiConfig';
import { ApiPage } from '../../core/network/ApiContract';
import { SessionStore } from '../../core/auth/SessionStore';
import { SessionService } from '../../core/auth/SessionService';
import { ActivitySummary, ActivityDetail, ActivityAdmin, Registration, RegistrationLookup, MyRegistration, SignupInput,
  StaffActivity, ActivityBoard, CheckInInput, ServeResult, PhoneResult, AttendanceResult, RegistrationIdInput,
  IssueUpdateInput, AnonymousUpdateInput, PhoneInput, ActivitySaveInput, AdminRegistration, AdminRegistrationUpdate } from './ActivityContract';

export class ActivityService {
  private static async token(): Promise<string> {
    const identity = SessionService.current();
    const token: string = await SessionStore.readToken();
    if (token === '' || identity === null || identity !== SessionService.current()) {
      throw new ApiRequestError('UNAUTHENTICATED', '请先登录', 401, '');
    }
    return token;
  }
  static async list(): Promise<ActivitySummary[]> {
    return ApiClient.get<ActivitySummary[]>(ApiConfig.getBaseUrl(), '/api/v1/repair-activities', '');
  }
  static async detail(id: string): Promise<ActivityDetail> {
    return ApiClient.get<ActivityDetail>(ApiConfig.getBaseUrl(), `/api/v1/repair-activities/${encodeURIComponent(id)}`, '');
  }
  static async signup(id: string, input: SignupInput): Promise<Registration> {
    return ApiClient.post<Registration>(ApiConfig.getBaseUrl(), `/api/v1/customer/repair-activities/${encodeURIComponent(id)}/registrations`, JSON.stringify(input), await ActivityService.token());
  }
  static async mine(page: number): Promise<ApiPage<MyRegistration>> {
    return ApiClient.getPage<MyRegistration>(ApiConfig.getBaseUrl(), `/api/v1/customer/activity-registrations?page=${page}&pageSize=20`, await ActivityService.token());
  }
  static async registration(activityId: string, id: string): Promise<MyRegistration> {
    return ApiClient.get<MyRegistration>(ApiConfig.getBaseUrl(), `/api/v1/customer/activity-registrations/${encodeURIComponent(id)}?activityId=${encodeURIComponent(activityId)}`, await ActivityService.token());
  }
  static async updateMine(activityId: string, id: string, issueType: string): Promise<MyRegistration> {
    const input: IssueUpdateInput = { activityId: activityId, issueType: issueType };
    return ApiClient.post<MyRegistration>(ApiConfig.getBaseUrl(), `/api/v1/customer/activity-registrations/${encodeURIComponent(id)}`, JSON.stringify(input), await ActivityService.token());
  }
  static async lookup(activityId: string, phone: string): Promise<RegistrationLookup> {
    const input: PhoneInput = { phone: phone };
    return ApiClient.post<RegistrationLookup>(ApiConfig.getBaseUrl(), `/api/v1/repair-activities/${encodeURIComponent(activityId)}/registrations/lookup`, JSON.stringify(input), '');
  }
  static async updateAnonymous(activityId: string, item: RegistrationLookup, phone: string, issueType: string): Promise<Registration> {
    const input: AnonymousUpdateInput = { phone: phone, editToken: item.editToken, issueType: issueType };
    return ApiClient.post<Registration>(ApiConfig.getBaseUrl(), `/api/v1/repair-activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(item.id)}`, JSON.stringify(input), '');
  }
  static async staffActivities(): Promise<StaffActivity[]> {
    return ApiClient.get<StaffActivity[]>(ApiConfig.getBaseUrl(), '/api/v1/member/repair-activities', await ActivityService.token());
  }
  static async board(id: string): Promise<ActivityBoard> {
    return ApiClient.get<ActivityBoard>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/board`, await ActivityService.token());
  }
  static async attend(id: string): Promise<AttendanceResult> {
    return ApiClient.post<AttendanceResult>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/attendance`, '{}', await ActivityService.token());
  }
  static async checkIn(id: string, input: CheckInInput): Promise<Object> {
    return ApiClient.post<Object>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/check-in`, JSON.stringify(input), await ActivityService.token());
  }
  static async withdraw(id: string, regId: string): Promise<Registration> {
    const input: RegistrationIdInput = { registrationId: regId };
    return ApiClient.post<Registration>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/withdraw`, JSON.stringify(input), await ActivityService.token());
  }
  static async serve(id: string, regId: string): Promise<ServeResult> {
    const input: RegistrationIdInput = { registrationId: regId };
    return ApiClient.post<ServeResult>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/serve`, JSON.stringify(input), await ActivityService.token());
  }
  static async phone(id: string, regId: string): Promise<PhoneResult> {
    return ApiClient.get<PhoneResult>(ApiConfig.getBaseUrl(), `/api/v1/member/repair-activities/${encodeURIComponent(id)}/registrations/${encodeURIComponent(regId)}/phone`, await ActivityService.token());
  }
  static async adminList(): Promise<ActivityAdmin[]> {
    return ApiClient.get<ActivityAdmin[]>(ApiConfig.getBaseUrl(), '/api/v1/admin/repair-activities', await ActivityService.token());
  }
  static async saveActivity(id: string, input: ActivitySaveInput): Promise<ActivityAdmin> {
    return ApiClient.post<ActivityAdmin>(ApiConfig.getBaseUrl(), `/api/v1/admin/repair-activities${id === '' ? '' : '/' + encodeURIComponent(id)}`, JSON.stringify(input), await ActivityService.token());
  }
  static async deleteActivity(id: string): Promise<Object> {
    return ApiClient.del<Object>(ApiConfig.getBaseUrl(), `/api/v1/admin/repair-activities/${encodeURIComponent(id)}`, await ActivityService.token());
  }
  static async adminRegistrations(id: string): Promise<AdminRegistration[]> {
    return ApiClient.get<AdminRegistration[]>(ApiConfig.getBaseUrl(), `/api/v1/admin/repair-activities/${encodeURIComponent(id)}/registrations`, await ActivityService.token());
  }
  static async saveRegistration(id: string, regId: string, input: AdminRegistrationUpdate): Promise<AdminRegistration> {
    return ApiClient.post<AdminRegistration>(ApiConfig.getBaseUrl(), `/api/v1/admin/repair-activities/${encodeURIComponent(id)}/registrations/${encodeURIComponent(regId)}`, JSON.stringify(input), await ActivityService.token());
  }
  static async deleteRegistration(id: string, regId: string): Promise<Object> {
    return ApiClient.del<Object>(ApiConfig.getBaseUrl(), `/api/v1/admin/repair-activities/${encodeURIComponent(id)}/registrations/${encodeURIComponent(regId)}`, await ActivityService.token());
  }
}
