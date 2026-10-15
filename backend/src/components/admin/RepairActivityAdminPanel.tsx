"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AdminModal } from "@/components/admin/AdminModal";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminCopy, adminShared } from "@/config/admin";
import { adminFetch } from "@/features/admin/admin-client";
import {
  repairActivityIssueTypeLabels,
  repairActivityStatusShortLabels,
  REPAIR_ACTIVITY_CAPACITY_MIN,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  RegistrationAdminView,
  RepairActivityAdminView,
} from "@/features/repair-activities/repair-activity-service";

/**
 * 维修活动管理（M1）：列表 + 新建/编辑表单 + 软删确认。
 * 交互对齐 SkillAdminPanel / CategoryAdminPanel，时间字段对齐 InviteCodeAdminPanel。
 */
export function RepairActivityAdminPanel() {
  const copy = adminCopy.repairActivities;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState("");
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [items, setItems] = useState<RepairActivityAdminView[]>([]);
  const [editing, setEditing] = useState<RepairActivityAdminView | null>(null);
  const [removing, setRemoving] = useState<RepairActivityAdminView | null>(null);
  const [busy, setBusy] = useState(false);
  const [registrationActivity, setRegistrationActivity] = useState<RepairActivityAdminView | null>(
    null,
  );
  const [registrations, setRegistrations] = useState<RegistrationAdminView[]>([]);
  const [registrationState, setRegistrationState] = useState<"idle" | "loading" | "ready">("idle");
  const [registrationProblem, setRegistrationProblem] = useState("");
  const [editingRegistration, setEditingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );
  const [removingRegistration, setRemovingRegistration] = useState<RegistrationAdminView | null>(
    null,
  );

  const load = useCallback(async () => {
    setState((current) => (current === "ready" ? "ready" : "loading"));
    setProblem("");
    const result = await adminFetch<RepairActivityAdminView[]>("/api/v1/admin/repair-activities");
    if (!result.ok) {
      setState("error");
      setProblem(result.message);
      return;
    }
    setItems(result.data);
    setState("ready");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    setToast(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const result = await adminFetch<RepairActivityAdminView>("/api/v1/admin/repair-activities", {
      method: "POST",
      body: {
        title: data.title ?? "",
        location: data.location?.trim() || null,
        capacity: Number(data.capacity),
        activityAt: toIso(data.activityAt ?? ""),
        signupOpensAt: toIso(data.signupOpensAt ?? ""),
        signupClosesAt: toIso(data.signupClosesAt ?? ""),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    form.reset();
    setToast({ text: copy.create.created, tone: "success" });
    await load();
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setProblem("");
    setToast(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<RepairActivityAdminView>(
      `/api/v1/admin/repair-activities/${editing.id}`,
      {
        method: "PATCH",
        body: {
          title: data.title ?? "",
          location: data.location?.trim() || null,
          capacity: Number(data.capacity),
          activityAt: toIso(data.activityAt ?? ""),
          signupOpensAt: toIso(data.signupOpensAt ?? ""),
          signupClosesAt: toIso(data.signupClosesAt ?? ""),
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditing(null);
    setToast({ text: copy.edit.saved, tone: "success" });
    await load();
  }

  async function openRegistrations(activity: RepairActivityAdminView) {
    setRegistrationActivity(activity);
    setEditingRegistration(null);
    setRemovingRegistration(null);
    setRegistrationState("loading");
    setRegistrationProblem("");
    const result = await adminFetch<RegistrationAdminView[]>(
      `/api/v1/admin/repair-activities/${activity.id}/registrations`,
    );
    if (!result.ok) {
      setRegistrationState("ready");
      setRegistrationProblem(result.message);
      return;
    }
    setRegistrations(result.data);
    setRegistrationState("ready");
  }

  async function saveRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!registrationActivity || !editingRegistration) return;
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const result = await adminFetch<RegistrationAdminView>(
      `/api/v1/admin/repair-activities/${registrationActivity.id}/registrations/${editingRegistration.id}`,
      {
        method: "PATCH",
        body: {
          name: data.name ?? "",
          ...(data.phone?.trim() ? { phone: data.phone } : {}),
          issueType: data.issueType ?? "",
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      setRegistrationProblem(result.message);
      return;
    }
    setRegistrations((items) =>
      items.map((item) => (item.id === result.data.id ? result.data : item)),
    );
    setEditingRegistration(null);
    setRegistrationProblem("");
  }

  async function confirmRegistrationRemove() {
    if (!registrationActivity || !removingRegistration) return;
    setBusy(true);
    const result = await adminFetch<{ deleted: boolean }>(
      `/api/v1/admin/repair-activities/${registrationActivity.id}/registrations/${removingRegistration.id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setRegistrationProblem(result.message);
      return;
    }
    setRegistrations((items) =>
      items.map((item) =>
        item.id === removingRegistration.id
          ? { ...item, deletedAt: new Date().toISOString() }
          : item,
      ),
    );
    setRemovingRegistration(null);
    setRegistrationProblem("");
    await load();
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<{ deleted: boolean }>(
      `/api/v1/admin/repair-activities/${removing.id}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setRemoving(null);
    setToast({ text: copy.removePanel.done, tone: "neutral" });
    await load();
  }

  /**
   * 报名列表的起始序号。这份报名一次取回、没有分页，因此永远是 1；
   * 口径与成员表的 `firstRowNumber + index` 一致 —— 序号是「列表里的第几行」，
   * 不是另一套业务编号。
   */
  const registrationFirstRowNumber = 1;

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-repair-activities-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <Card className="admin-panel">
        <form method="post" className="admin-form" onSubmit={create} aria-label={copy.create.title}>
          <h2 className="admin-panel__title">{copy.create.title}</h2>
          <div className="admin-form__grid">
            <label className="field">
              <span className="field__label">{copy.create.titleField}</span>
              <input className="field__input" name="title" required maxLength={120} />
            </label>
            <label className="field">
              <span className="field__label">地点（选填）</span>
              <input className="field__input" name="location" maxLength={200} />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.capacity}</span>
              <input
                className="field__input"
                name="capacity"
                type="number"
                required
                // Keep browser validation aligned with assertValidCapacity (server lower bound = 1).
                min={REPAIR_ACTIVITY_CAPACITY_MIN}
                max={10000}
                defaultValue={30}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.signupOpensAt}</span>
              <input className="field__input" type="datetime-local" name="signupOpensAt" required />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.signupClosesAt}</span>
              <input
                className="field__input"
                type="datetime-local"
                name="signupClosesAt"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.create.activityAt}</span>
              <input className="field__input" type="datetime-local" name="activityAt" required />
            </label>
          </div>
          <p className="field__hint">{copy.create.timeHint}</p>
          <div className="signup__actions">
            <Button type="submit" variant="solid" icon="plus" disabled={busy}>
              {busy ? adminShared.submitting : copy.create.submit}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="admin-panel">
        <div className="admin-list-toolbar">
          <p className="muted">
            {state === "loading"
              ? adminShared.loading
              : copy.count.replace("{count}", String(items.length))}
          </p>
          {state === "error" ? (
            <Button variant="ghost" onClick={() => void load()}>
              {adminShared.reload}
            </Button>
          ) : null}
        </div>

        {state === "ready" && items.length === 0 ? (
          <p className="muted">{adminShared.empty}</p>
        ) : null}

        {items.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{copy.table.title}</th>
                  <th>{copy.table.activityAt}</th>
                  <th>{copy.table.window}</th>
                  <th>{copy.table.capacity}</th>
                  <th>{copy.table.status}</th>
                  <th>{copy.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label={copy.table.title}>{item.title}</td>
                    <td data-label={copy.table.activityAt}>{formatDateTime(item.activityAt)}</td>
                    <td data-label={copy.table.window}>
                      {formatDateTime(item.signupOpensAt)}
                      <span className="muted"> → </span>
                      {formatDateTime(item.signupClosesAt)}
                    </td>
                    <td data-label={copy.table.capacity}>
                      <span className="admin-capacity">
                        {copy.capacityLine
                          .replace("{registered}", String(item.registeredCount))
                          .replace("{capacity}", String(item.capacity))}
                      </span>
                      <br />
                      <span className="muted">
                        {copy.remaining.replace("{count}", String(item.remaining))}
                      </span>
                    </td>
                    <td data-label={copy.table.status}>
                      <span className={repairActivityStatusBadgeClass(item.status)}>
                        {repairActivityStatusShortLabels[item.status as RepairActivityStatus] ??
                          item.status}
                      </span>
                    </td>
                    <td data-label={copy.table.actions}>
                      <div className="admin-row-actions">
                        <Button variant="ghost" disabled={busy} onClick={() => setEditing(item)}>
                          {copy.action.edit}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void openRegistrations(item)}
                        >
                          {copy.action.registrations}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setRemoving(item)}>
                          {copy.action.remove}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {editing ? (
        <AdminModal title={copy.edit.title} onClose={() => setEditing(null)}>
          <form className="admin-form" onSubmit={saveEdit}>
            <div className="admin-form__grid">
              <label className="field">
                <span className="field__label">{copy.create.titleField}</span>
                <input
                  className="field__input"
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={editing.title}
                />
              </label>
              <label className="field">
                <span className="field__label">地点（选填）</span>
                <input
                  className="field__input"
                  name="location"
                  maxLength={200}
                  defaultValue={editing.location ?? ""}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.capacity}</span>
                <input
                  className="field__input"
                  name="capacity"
                  type="number"
                  required
                  min={REPAIR_ACTIVITY_CAPACITY_MIN}
                  max={10000}
                  defaultValue={editing.capacity}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.signupOpensAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="signupOpensAt"
                  required
                  defaultValue={toLocalInput(editing.signupOpensAt)}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.signupClosesAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="signupClosesAt"
                  required
                  defaultValue={toLocalInput(editing.signupClosesAt)}
                />
              </label>
              <label className="field">
                <span className="field__label">{copy.create.activityAt}</span>
                <input
                  className="field__input"
                  type="datetime-local"
                  name="activityAt"
                  required
                  defaultValue={toLocalInput(editing.activityAt)}
                />
              </label>
            </div>
            <div className="signup__actions">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {copy.edit.cancel}
              </Button>
              <Button type="submit" variant="solid" disabled={busy}>
                {busy ? adminShared.submitting : copy.edit.submit}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {registrationActivity ? (
        <AdminModal
          title={copy.registrations.title}
          subtitle={registrationActivity.title}
          onClose={() => setRegistrationActivity(null)}
        >
          {registrationProblem ? (
            <p className="admin-status admin-status--error" role="alert">
              {registrationProblem}
            </p>
          ) : null}
          {registrationState === "loading" ? <p className="muted">{adminShared.loading}</p> : null}
          {registrationState === "ready" && registrations.length === 0 ? (
            <p className="muted">{copy.registrations.empty}</p>
          ) : null}
          {registrations.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{copy.registrations.rowNumber}</th>
                    <th>{copy.registrations.name}</th>
                    <th>{copy.registrations.phone}</th>
                    <th>{copy.registrations.issueType}</th>
                    <th>{copy.registrations.deviceModel}</th>
                    <th>{copy.registrations.status}</th>
                    <th>{copy.table.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {registrations.map((registration, index) => (
                    <tr key={registration.id}>
                      <td data-label={copy.registrations.rowNumber}>
                        {registrationFirstRowNumber + index}
                      </td>
                      <td data-label={copy.registrations.name}>{registration.name}</td>
                      <td data-label={copy.registrations.phone}>{registration.phoneMasked}</td>
                      <td data-label={copy.registrations.issueType}>
                        {repairActivityIssueTypeLabels[registration.issueType] ??
                          registration.issueType}
                      </td>
                      <td data-label={copy.registrations.deviceModel}>
                        {registration.deviceModel ?? "—"}
                      </td>
                      <td data-label={copy.registrations.status}>
                        {registration.deletedAt ? copy.registrations.deleted : registration.status}
                      </td>
                      <td data-label={copy.table.actions}>
                        <div className="admin-row-actions">
                          <Button
                            variant="ghost"
                            disabled={busy || Boolean(registration.deletedAt)}
                            onClick={() => setEditingRegistration(registration)}
                          >
                            {copy.registrations.edit}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || Boolean(registration.deletedAt)}
                            onClick={() => setRemovingRegistration(registration)}
                          >
                            {copy.registrations.delete}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AdminModal>
      ) : null}

      {editingRegistration && registrationActivity ? (
        <AdminModal title={copy.registrations.edit} onClose={() => setEditingRegistration(null)}>
          <form className="admin-form" onSubmit={saveRegistration}>
            <label className="field">
              <span className="field__label">{copy.registrations.name}</span>
              <input
                className="field__input"
                name="name"
                required
                minLength={2}
                maxLength={40}
                defaultValue={editingRegistration.name}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.registrations.phone}</span>
              <input
                className="field__input"
                name="phone"
                placeholder="留空保持原手机号"
                inputMode="numeric"
                maxLength={11}
                defaultValue={""}
              />
            </label>
            <label className="field">
              <span className="field__label">{copy.registrations.issueType}</span>
              <select
                className="field__input"
                name="issueType"
                required
                defaultValue={editingRegistration.issueType}
              >
                {Object.entries(repairActivityIssueTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="signup__actions">
              <Button type="button" variant="ghost" onClick={() => setEditingRegistration(null)}>
                {copy.registrations.cancel}
              </Button>
              <Button type="submit" variant="solid" disabled={busy}>
                {busy ? adminShared.submitting : copy.registrations.save}
              </Button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {removingRegistration ? (
        <ConfirmDialog
          title={copy.registrations.delete}
          cancelLabel={copy.registrations.cancel}
          confirmLabel={busy ? adminShared.submitting : copy.registrations.delete}
          busy={busy}
          onClose={() => {
            if (!busy) setRemovingRegistration(null);
          }}
          onConfirm={() => void confirmRegistrationRemove()}
        >
          <p>{copy.registrations.deleteHint}</p>
          <p>
            <strong>
              {removingRegistration.name} · {removingRegistration.phoneMasked}
            </strong>
          </p>
        </ConfirmDialog>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={copy.removePanel.title}
          cancelLabel={copy.removePanel.cancel}
          confirmLabel={busy ? adminShared.submitting : copy.removePanel.submit}
          busy={busy}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
          onConfirm={() => void confirmRemove()}
        >
          <p>{copy.removePanel.hint}</p>
          <p>
            <strong>{removing.title}</strong>
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
