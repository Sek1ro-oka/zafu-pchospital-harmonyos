import type { Prisma } from "@/generated/prisma/client";
import { repairDetailInclude } from "@/features/repairs/repair-repository";
import { uploadLimits } from "@/features/repairs/repair-photo-storage";
import type { AuthorizedActor, RepairDetailView, RepairView } from "@/types/contracts";

type RecordRow = Prisma.RepairRecordGetPayload<{ include: typeof repairDetailInclude }>;

export function toRepairView(
  record: RecordRow,
  options: { canViewOwnerPhone?: boolean } = {},
): RepairView {
  const name =
    record.memberProfile.nickname ||
    record.memberProfile.realName ||
    record.memberProfile.user.displayName ||
    "成员";
  return {
    id: record.id,
    member: { id: record.memberProfile.id, name },
    repairDate: record.repairDate?.toISOString().slice(0, 10) ?? null,
    durationMinutes: record.durationMinutes,
    category: record.category
      ? {
          id: record.category.id,
          code: record.category.code,
          name: record.category.name,
          description: record.category.description,
          sortOrder: record.category.sortOrder,
          isActive: record.category.isActive,
        }
      : null,
    deviceModel: record.deviceModel,
    ownerName: record.ownerName ?? null,
    ownerPhone: options.canViewOwnerPhone === true ? (record.ownerPhone ?? null) : null,
    content: record.content,
    result: record.result as RepairView["result"],
    remark: record.remark,
    status: record.status as RepairView["status"],
    isDifficult: record.isDifficult,
    isTypical: record.isTypical,
    version: record.version,
    submittedAt: record.submittedAt?.toISOString() ?? null,
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    photos: record.photos.map((photo) => ({
      id: photo.id,
      contentUrl: `/api/v1/repair-photos/${photo.id}/content`,
      originalName: photo.originalName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      sortOrder: photo.sortOrder,
      createdAt: photo.createdAt.toISOString(),
    })),
  };
}

export function toRepairDetail(
  record: RecordRow,
  actor: AuthorizedActor,
  options: { isFavorited?: boolean } = {},
): RepairDetailView {
  const owner = record.memberProfile.userId === actor.userId;
  return {
    ...toRepairView(record, {
      canViewOwnerPhone: owner || actor.permissions.includes("repair:review"),
    }),
    canEdit: owner && (record.status === "DRAFT" || record.status === "REJECTED"),
    canReview: actor.permissions.includes("repair:review") && record.status === "PENDING",
    canFlag: actor.permissions.includes("repair:flag"),
    isFavorited: options.isFavorited === true,
    photoLimits: uploadLimits(),
    reviews: record.reviews.map((review) => ({
      id: review.id,
      decision: review.decision as "APPROVED" | "REJECTED",
      note: review.note,
      reviewerName: review.reviewer.displayName,
      createdAt: review.createdAt.toISOString(),
    })),
    timeline: record.timeline.map((event) => ({
      id: event.id,
      eventType: event.eventType as RepairDetailView["timeline"][number]["eventType"],
      summary: event.summary,
      actorName: event.actor?.displayName ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
