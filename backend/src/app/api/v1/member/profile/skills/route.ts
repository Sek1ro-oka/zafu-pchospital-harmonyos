import { memberProfileService } from "@/features/member-profile/member-profile-service";
import { updateSkillsInput } from "@/features/member-profile/member-profile-http";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getRequestId } from "@/lib/api/request-id";
import { assertWriteAccess, authenticateRequest } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `PUT /api/v1/member/profile/skills` —— 完整期望集合，幂等保存（M3 任务书 §10.3）。 */
export async function PUT(request: Request) {
  const requestId = getRequestId(request.headers);
  try {
    assertWriteAccess(request);
    const { actor } = await authenticateRequest(request, requestId);
    const body = (await request.json()) as Record<string, unknown>;
    return apiSuccess(
      await memberProfileService.updateSkills(updateSkillsInput(body), actor),
      requestId,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiFailure(error, requestId);
  }
}

export const POST = PUT;
