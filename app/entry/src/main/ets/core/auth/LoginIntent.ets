import { HOME_STAFF, SessionIdentity } from './AuthContract';
import { ROUTE_REPAIR_ORDERS, ROUTE_STAFF_ORDERS } from '../ui/Routes';

/** 仅记录用户想去哪里，不缓存用户身份或业务结果。 */
export class LoginIntent {
  route: string = '';
  param: Object | null = null;
  tab: number = -1;
}

export function routeAfterLogin(route: string, identity: SessionIdentity): string {
  // 游客点报修后登录为工作人员，应进入其工作台，而不是客户报修页。
  return route === ROUTE_REPAIR_ORDERS && identity.home === HOME_STAFF ? ROUTE_STAFF_ORDERS : route;
}
