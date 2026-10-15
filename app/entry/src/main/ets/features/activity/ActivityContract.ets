export interface ActivityParam { activityId: string; }
export interface RegistrationParam { activityId: string; registrationId: string; }
export interface ActivitySummary {
  id: string; title: string; activityAt: string; capacity: number;
  signupOpensAt: string; signupClosesAt: string; status: string; registeredCount: number; remaining: number;
}
export interface ActivityConsent { version: string; title: string; clauses: string[]; }
export interface ActivityDetail extends ActivitySummary { location: string | null; consent: ActivityConsent; }
export interface ActivityAdmin extends ActivitySummary { location: string | null; }
export interface Registration {
  id: string; activityId: string; name: string; phoneMasked: string; issueType: string;
  deviceModel: string | null; status: string; createdAt: string;
}
export interface RegistrationLookup extends Registration { editToken: string; editTokenExpiresAt: string; }
export interface RegistrationActivity { id: string; title: string; location: string | null; activityAt: string; signupClosesAt: string; }
export interface MyRegistration extends Registration {
  activity: RegistrationActivity; checkedInAt: string | null; servedAt: string | null; canEditIssueType: boolean;
}
export interface SignupInput {
  name: string; phone: string; issueType: string; deviceModel: string; consentAccepted: boolean; consentVersion: string;
}
export interface StaffActivity extends ActivitySummary { attended: boolean; canOperateStaff: boolean; }
export interface StaffRegistration extends Registration {
  issueTypeLabel: string; checkedInAt: string | null; servedAt: string | null; repairRecordId: string | null;
}
export interface ServedRegistration extends StaffRegistration { recordStatus: string | null; canOpenRecord: boolean; }
export interface PendingServeDraft { repairRecordId: string; ownerName: string; activityTitle: string; }
export interface ActivityBoard {
  activity: StaffActivity; attended: boolean; attendanceCheckedInAt: string | null;
  eligible: StaffRegistration[]; queue: StaffRegistration[]; served: ServedRegistration[];
  pendingServeDraft: PendingServeDraft | null;
}
export interface ServeResult { registration: StaffRegistration; repairRecordId: string; }
export interface PhoneResult { phone: string; }
export interface AttendanceResult { attended: boolean; checkedInAt: string; }
export interface CheckInUpdate { registrationId: string; issueType: string; }
export interface CheckInInput { registrationIds: string[]; issueTypeUpdates: CheckInUpdate[]; }
export interface RegistrationIdInput { registrationId: string; }
export interface IssueUpdateInput { activityId: string; issueType: string; }
export interface AnonymousUpdateInput { phone: string; editToken: string; issueType: string; }
export interface PhoneInput { phone: string; }
export interface ActivitySaveInput {
  title: string; location: string | null; capacity: number; activityAt: string; signupOpensAt: string; signupClosesAt: string;
}
export interface AdminRegistration extends Registration { deletedAt: string | null; }
export interface AdminRegistrationUpdate { name: string; phone?: string; issueType: string; }
export const ACTIVITY_ISSUE_TYPES: string[] = ['CLEAN_PASTE', 'CLEAN_ONLY', 'SOFTWARE_SYSTEM', 'OTHER'];
export const ACTIVITY_ISSUE_LABELS: string[] = ['清灰换硅脂', '清灰', '软件 / 系统问题', '其他故障'];
export function activityIssueLabel(value: string): string {
  const index: number = ACTIVITY_ISSUE_TYPES.indexOf(value);
  return index >= 0 ? ACTIVITY_ISSUE_LABELS[index] : value;
}
export function activityStatusLabel(value: string): string {
  if (value === 'OPEN') return '报名中';
  if (value === 'FULL') return '已报满';
  if (value === 'CLOSED') return '报名截止';
  if (value === 'ENDED') return '已结束';
  return '未开始';
}
export function registrationStatusLabel(value: string): string {
  if (value === 'CHECKED_IN') return '已签到 · 排队中';
  if (value === 'SERVED') return '已接待（维修状态请联系成员）';
  return '已报名 · 待签到';
}
export function activityTime(value: string | null): string {
  if (value === null || value === '') return '暂无';
  const time: Date = new Date(new Date(value).getTime() + 8 * 3600000);
  return `${time.getUTCFullYear()}-${(time.getUTCMonth() + 1).toString().padStart(2, '0')}-${time.getUTCDate().toString().padStart(2, '0')} ${time.getUTCHours().toString().padStart(2, '0')}:${time.getUTCMinutes().toString().padStart(2, '0')}`;
}
