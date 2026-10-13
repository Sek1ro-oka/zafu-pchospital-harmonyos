export interface CustomerProfileView {
  displayName: string;
  nickname: string | null;
  phone: string | null;
  version: number;
  avatarUrl: string | null;
}
export interface SkillView { id: string; name: string; isActive: boolean; }
export interface MemberProfileView {
  memberProfileId: string; displayName: string; nickname: string | null;
  realName: string | null; qq: string | null; studentId?: string | null; className?: string | null;
  skills: SkillView[]; version: number;
}
export interface MemberProfileResult { profile: MemberProfileView; }
export interface MemberSkillsResult { skills: SkillView[]; version: number; }
export interface CustomerProfileUpdate { nickname: string | null; phone: string | null; version: number; }
export interface MemberProfileUpdate { nickname: string | null; version: number; }
export interface MemberSkillsUpdate { skillIds: string[]; profileVersion: number; }
export interface MemberDirectoryEntry { memberProfileId: string; displayName: string; }
export interface MemberDirectoryResult { items: MemberDirectoryEntry[]; page: number; hasMore: boolean; }
export interface PersonalProfileParam { memberProfileId: string; }
