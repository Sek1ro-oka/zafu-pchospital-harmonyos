import { customerUser } from "@/features/customer-profile/customer-profile-service";
import { getDb } from "@/lib/db/client";
import { paginationMeta } from "@/lib/api/pagination";
import { AppError } from "@/lib/api/errors";
import type { AuthorizedActor, PaginationInput } from "@/types/contracts";
export const customerNotificationService = {
  async list(pagination: PaginationInput, actor: AuthorizedActor) {
    const user = await customerUser(actor),
      db = getDb(),
      where = { userId: user.id, deletedAt: null };
    const [total, unreadCount, rows] = await Promise.all([
      db.customerNotification.count({ where }),
      db.customerNotification.count({ where: { ...where, readAt: null } }),
      db.customerNotification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
        select: {
          id: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
          repairOrderId: true,
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
      pagination: paginationMeta(pagination, total),
    };
  },
  async read(id: string, actor: AuthorizedActor) {
    const user = await customerUser(actor);
    const result = await getDb().customerNotification.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { readAt: new Date() },
    });
    if (!result.count) throw new AppError("NOTIFICATION_NOT_FOUND", "消息不存在或不可访问");
  },
  async readAll(actor: AuthorizedActor) {
    const user = await customerUser(actor);
    const result = await getDb().customerNotification.updateMany({
      where: { userId: user.id, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
    return { updatedCount: result.count };
  },
  async remove(id: string, actor: AuthorizedActor) {
    const user = await customerUser(actor);
    const result = await getDb().customerNotification.updateMany({
      where: { id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new AppError("NOTIFICATION_NOT_FOUND", "消息不存在或不可访问");
  },
};
