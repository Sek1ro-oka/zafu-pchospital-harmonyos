"use client";

import { useCallback, useEffect, useState } from "react";

import { formatShanghaiDateTime } from "@/components/repair-activities/activity-format";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { memberRepairActivitiesCopy } from "@/config/repair-activities";
import type {
  StaffBoardView,
  StaffRegistrationView,
} from "@/features/repair-activities/repair-activity-staff-service";

type Props = { activityId: string };

export function MemberRepairActivityBoard({ activityId }: Props) {
  const copy = memberRepairActivitiesCopy.board;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [board, setBoard] = useState<StaffBoardView | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<StaffRegistrationView | null>(null);

  const load = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`/api/v1/member/repair-activities/${activityId}/board`, {
        cache: "no-store",
      });
      const json = (await response.json()) as {
        success: boolean;
        data?: StaffBoardView;
        error?: { message?: string };
      };
      if (!json.success || !json.data) {
        setState("error");
        setMessage(json.error?.message ?? copy.loadFailed);
        return;
      }
      setBoard(json.data);
      setSelected(new Set());
      setState("ready");
    } catch {
      setState("error");
      setMessage(copy.loadFailed);
    }
  }, [activityId, copy.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function postJson<T>(
    path: string,
    body: Record<string, unknown>,
    method: "POST" | "DELETE" = "POST",
  ): Promise<{ ok: true; data: T } | { ok: false; message: string; code?: string }> {
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as {
        success: boolean;
        data?: T;
        error?: { message?: string; code?: string };
      };
      if (!json.success || json.data === undefined) {
        return {
          ok: false,
          message: json.error?.message ?? copy.loadFailed,
          code: json.error?.code,
        };
      }
      return { ok: true, data: json.data };
    } catch {
      return { ok: false, message: copy.loadFailed };
    }
  }

  async function attend() {
    setBusy("attend");
    setToast(null);
    const result = await postJson<{ attended: boolean }>(
      `/api/v1/member/repair-activities/${activityId}/attendance`,
      {},
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setToast(copy.attendSuccess);
    await load();
  }

  async function cancelAttendance() {
    if (busy !== null) return;
    setBusy("cancel-attendance");
    setMessage("");
    setToast(null);
    const result = await postJson<{ attended: false }>(
      `/api/v1/member/repair-activities/${activityId}/attendance`,
      {},
      "DELETE",
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setCancelOpen(false);
    setToast("已取消本人本场出勤");
    await load();
  }

  async function checkIn() {
    if (selected.size === 0) {
      setMessage(copy.selectNone);
      return;
    }
    setBusy("check-in");
    setToast(null);
    setMessage("");
    const result = await postJson<{ checkedIn: StaffRegistrationView[] }>(
      `/api/v1/member/repair-activities/${activityId}/check-in`,
      { registrationIds: [...selected] },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setToast(copy.checkInSuccess);
    await load();
  }

  async function confirmWithdraw() {
    if (!withdrawTarget) return;
    const registrationId = withdrawTarget.id;
    setBusy(`withdraw:${registrationId}`);
    setToast(null);
    setMessage("");
    const result = await postJson<StaffRegistrationView>(
      `/api/v1/member/repair-activities/${activityId}/withdraw`,
      { registrationId },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setWithdrawTarget(null);
    setToast(copy.withdrawSuccess);
    await load();
  }

  async function serve(registrationId: string) {
    setBusy(`serve:${registrationId}`);
    setToast(null);
    setMessage("");
    const result = await postJson<{ repairRecordId: string }>(
      `/api/v1/member/repair-activities/${activityId}/serve`,
      { registrationId },
    );
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    await load();
    window.location.assign(`/member/repairs/${result.data.repairRecordId}/edit`);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (state === "loading") {
    return (
      <div className="activity-board activity-board--loading" role="status">
        <p className="muted">{copy.loading}</p>
      </div>
    );
  }
  if (state === "error" || !board) {
    return (
      <div className="activity-board">
        <p className="admin-status admin-status--error" role="alert">
          {message || copy.loadFailed}
        </p>
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
      </div>
    );
  }

  const opsDisabled = !board.attended || busy !== null;
  const withdrawBusy = withdrawTarget ? busy === `withdraw:${withdrawTarget.id}` : false;

  return (
    <div className="activity-board">
      {cancelOpen ? (
        <ConfirmDialog
          title="取消本场出勤？"
          confirmLabel="确认取消出勤"
          cancelLabel="返回"
          busy={busy === "cancel-attendance"}
          onConfirm={() => void cancelAttendance()}
          onClose={() => setCancelOpen(false)}
        >
          <p>只取消本人出勤，不影响客户报名、排队或已有备案；已进行现场处理时不能取消。</p>
          {message ? <p role="alert">{message}</p> : null}
        </ConfirmDialog>
      ) : null}
      <div className="activity-board__toolbar">
        <Button href="/member/repair-activities" variant="ghost">
          {copy.back}
        </Button>
        {board.attended ? (
          <>
            <span className="admin-tag admin-tag--accent">{copy.attendedBadge}</span>
            {board.canCancelAttendance ? (
              <Button variant="ghost" disabled={busy !== null} onClick={() => setCancelOpen(true)}>
                取消本场出勤
              </Button>
            ) : (
              <span>{board.attendanceCancelBlockedReason}</span>
            )}
          </>
        ) : (
          <Button
            className="activity-board__attend-cta"
            variant="solid"
            onClick={() => void attend()}
            disabled={busy !== null}
          >
            {busy === "attend" ? copy.attending : copy.attendCta}
          </Button>
        )}
      </div>

      {!board.attended ? (
        <Card className="activity-board__attend-banner" variant="notice">
          <p role="status">{copy.attendPrompt}</p>
          <Button variant="solid" onClick={() => void attend()} disabled={busy !== null}>
            {busy === "attend" ? copy.attending : copy.attendCta}
          </Button>
        </Card>
      ) : null}
      {message ? (
        <p className="admin-status admin-status--error" role="alert">
          {message}
        </p>
      ) : null}
      {toast ? (
        <p className="admin-status admin-status--success" role="status">
          {toast}
        </p>
      ) : null}

      {board.pendingServeDraft ? (
        <Card>
          <p>请先完成 {board.pendingServeDraft.ownerName} 的接待草稿。</p>
          <Button href={`/member/repairs/${board.pendingServeDraft.repairRecordId}`}>
            继续填写备案
          </Button>
        </Card>
      ) : null}
      <div className="activity-board__panes">
        <Card className="activity-board__pane">
          <header className="activity-board__pane-head">
            <h2>{copy.eligibleTitle}</h2>
            <span className="member-section__tag">{copy.eligibleTag}</span>
          </header>
          {board.eligible.length === 0 ? (
            <p className="muted activity-board__empty">{copy.eligibleEmpty}</p>
          ) : (
            <ul className="activity-board__list">
              {board.eligible.map((row) => (
                <li key={row.id} className="activity-board__row">
                  <label className="activity-board__check">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      disabled={opsDisabled}
                      onChange={() => toggle(row.id)}
                    />
                    <span>
                      <strong>{row.name}</strong>
                      <span className="muted">
                        {" "}
                        · {row.phoneMasked} · {row.issueTypeLabel}
                        {/* 机型选填：没填就不占位（issue #68）。 */}
                        {row.deviceModel ? ` · ${copy.deviceModel} ${row.deviceModel}` : null}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="activity-board__actions">
            <p className="muted">{copy.selectHint}</p>
            <Button
              variant="solid"
              onClick={() => void checkIn()}
              disabled={opsDisabled || selected.size === 0}
            >
              {busy === "check-in" ? copy.checkingIn : copy.checkIn}
            </Button>
          </div>
        </Card>

        <Card className="activity-board__pane">
          <header className="activity-board__pane-head">
            <h2>{copy.queueTitle}</h2>
            <span className="member-section__tag">{copy.queueTag}</span>
          </header>
          {board.queue.length === 0 ? (
            <p className="muted activity-board__empty">{copy.queueEmpty}</p>
          ) : (
            <ul className="activity-board__list">
              {board.queue.map((row, index) => (
                <li key={row.id} className="activity-board__row activity-board__row--queue">
                  <div className="activity-board__queue-main">
                    {/* 队列位次：按当前渲染顺序从 1 开始（服务端已按签到时间升序）。 */}
                    <span className="activity-board__queue-rank">
                      {copy.queueRank.replace("{index}", String(index + 1))}
                    </span>
                    <div>
                      <strong>{row.name}</strong>
                      <div className="muted">
                        {copy.phone} {row.phoneMasked} · {copy.issueType} {row.issueTypeLabel}
                      </div>
                      {row.deviceModel ? (
                        <div className="muted">
                          {copy.deviceModel} {row.deviceModel}
                        </div>
                      ) : null}
                      {row.checkedInAt ? (
                        <div className="muted">
                          {copy.checkedInAt} {formatShanghaiDateTime(row.checkedInAt)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="activity-board__row-actions">
                    <Button
                      variant="solid"
                      onClick={() => void serve(row.id)}
                      disabled={opsDisabled || Boolean(board.pendingServeDraft)}
                    >
                      {busy === `serve:${row.id}` ? copy.serving : copy.serve}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setWithdrawTarget(row)}
                      disabled={opsDisabled}
                    >
                      {busy === `withdraw:${row.id}` ? copy.withdrawing : copy.withdraw}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2>已接待</h2>
        {board.served.length === 0 ? (
          <p>暂无已接待报名</p>
        ) : (
          board.served.map((row) => (
            <p key={row.id}>
              {row.name} · {row.phoneMasked} · {row.recordStatus ?? "备案不可用"}
              {row.repairRecordId && row.recordStatus && row.canOpenRecord ? (
                <Button href={`/member/repairs/${row.repairRecordId}`}>查看备案</Button>
              ) : null}
            </p>
          ))
        )}
      </Card>
      {withdrawTarget ? (
        <ConfirmDialog
          title={copy.withdrawConfirmTitle}
          cancelLabel={copy.withdrawCancel}
          confirmLabel={withdrawBusy ? copy.withdrawing : copy.withdrawConfirm}
          busy={withdrawBusy}
          onClose={() => {
            if (!withdrawBusy) setWithdrawTarget(null);
          }}
          onConfirm={() => void confirmWithdraw()}
        >
          <p>{copy.withdrawConfirmHint}</p>
          <p>
            <strong>
              {withdrawTarget.name} · {withdrawTarget.phoneMasked}
            </strong>
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
