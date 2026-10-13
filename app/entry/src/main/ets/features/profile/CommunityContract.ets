export interface FavoriteItem { id: string; kind: string; sourceId: string; title: string; targetId: string | null; available: boolean; }
export interface MemberFavoriteItem { id: string; repairRecordId: string; contentExcerpt: string; categoryName: string | null; }
export interface CustomerMessage { id: string; title: string; body: string; readAt: string | null; repairOrderId: string; }
export interface MemberMessage { id: string; type: string; status: string; repairRecordId: string | null; repairExcerpt: string | null; }
export interface MessageItem { id: string; title: string; body: string; unread: boolean; targetId: string | null; }
export interface CustomerMessageResult { items: CustomerMessage[]; unreadCount: number; }
export interface MemberMessageResult { items: MemberMessage[]; unreadCount: number; }
export interface MessageResult { items: MessageItem[]; unreadCount: number; }
export interface FavoriteInput { kind: string; sourceId: string; }
export interface MemberFavoriteInput { repairRecordId: string; }
export interface PublicCaseItem { caseId: string; title: string; contentVersion: number; }
export interface PublicCaseParam { caseId: string; }
export interface PublicCaseDetail { caseId: string; title: string; displayText: string; contentVersion: number; sources: PublicCaseSource[]; }
export interface PublicCaseSource { index: number; quotes: PublicCaseQuote[]; }
export interface PublicCaseQuote { field: string; quote: string; }
