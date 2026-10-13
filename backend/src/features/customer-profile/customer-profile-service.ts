import { AppError } from "@/lib/api/errors";
import { getDb } from "@/lib/db/client";
import { inSerializableTransaction } from "@/lib/db/transaction";
import type { AuthorizedActor } from "@/types/contracts";
import type { CustomerProfileInput } from "./customer-profile-input";

export async function customerUser(actor: AuthorizedActor) {
  if (!actor.userId) throw new AppError("UNAUTHENTICATED", "请先登录");
  const user = await getDb().user.findFirst({
    where: { id: actor.userId, status: "ACTIVE", deletedAt: null },
    include: {
      roles: { where: { revokedAt: null }, include: { role: true } },
      memberProfile: true,
      identities: { where: { deletedAt: null } },
    },
  });
  if (!user) throw new AppError("UNAUTHENTICATED", "账号不可用");
  if (
    user.memberProfile ||
    user.roles.some((entry) => ["MEMBER", "ADMIN"].includes(entry.role.code))
  ) {
    throw new AppError("FORBIDDEN", "此接口仅用于客户本人资料");
  }
  return user;
}

function profileView(
  user: { displayName: string | null },
  row: { nickname: string | null; phone: string | null; version: number } | null,
) {
  return {
    displayName: user.displayName ?? "客户",
    nickname: row?.nickname ?? null,
    phone: row?.phone ?? null,
    version: row?.version ?? 0,
    avatarUrl: null,
  };
}

export const customerProfileService = {
  async getSelf(actor: AuthorizedActor) {
    const user = await customerUser(actor);
    return profileView(
      user,
      await getDb().customerProfile.findUnique({ where: { userId: user.id } }),
    );
  },
  async updateSelf(input: CustomerProfileInput, actor: AuthorizedActor) {
    const user = await customerUser(actor);
    const qq = user.identities.find((identity) => identity.type === "QQ")?.identifierNormalized;
    const displayName = input.nickname ?? (qq ? `客户${qq}` : "客户");
    return inSerializableTransaction(async (tx) => {
      // 锁定当前账号；并发首次建档只有一个 version=0 请求能成功。
      await tx.user.update({ where: { id: user.id }, data: { displayName } });
      const current = await tx.customerProfile.findUnique({ where: { userId: user.id } });
      if ((current?.version ?? 0) !== input.version) {
        throw new AppError("CUSTOMER_PROFILE_VERSION_CONFLICT", "资料已被更新，请刷新后重试");
      }
      const row = await tx.customerProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, nickname: input.nickname, phone: input.phone },
        update: { nickname: input.nickname, phone: input.phone, version: { increment: 1 } },
      });
      // 只更新账号展示名与本人资料，绝不更新 RepairOrder/报名的联系快照。
      return profileView({ displayName }, row);
    });
  },
};
