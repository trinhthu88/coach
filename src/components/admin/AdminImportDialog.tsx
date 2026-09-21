import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, Download, History, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  executeAdminInvite,
  fetchInviteBatchRows,
  fetchRecentInviteBatches,
  inviteRowFromBatchRow,
  isExecutableRow,
  isProblemStatus,
  normalizeSheetRow,
  previewAdminInvite,
  type AdminInvitePreviewRow,
  type AdminInviteRole,
  type AdminInviteRowResult,
  type InviteBatch,
  type InviteBatchRow,
  type InviteOffer,
  type InviteRowInput,
  type PreviewStatus,
} from "@/lib/adminInvite";

type Step = "form" | "preview" | "results" | "resume";
type Tone = "default" | "secondary" | "destructive" | "outline";

const OFFER_LABEL: Record<InviteOffer, string> = {
  enroll_only: "addPerson.addEnrollmentOnly",
  transition: "addPerson.moveEnrollment",
  link_sponsor: "addPerson.addSponsorAccess",
};

const RESULT_TONE: Record<string, Tone> = {
  invited: "default",
  enrolled: "default",
  linked: "default",
  partial: "secondary",
  skipped: "outline",
  failed: "destructive",
  pending: "secondary",
};

interface AdminImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kept for callers; an import file must fill the Role column on every row. */
  defaultRole?: AdminInviteRole;
  onDone?: () => void;
}

/**
 * Bulk import (CSV / Excel): Full name*, Email*, Role*, Programme, Cohort,
 * Organization. A dry-run preview is mandatory — nothing is created until the
 * admin confirms it. Existing emails are offered "enrollment only" (or
 * "sponsor access") and never create a second account. Runs are tracked as
 * resumable batches. Everything goes through the admin-provision-user service.
 */
export function AdminImportDialog({ open, onOpenChange, onDone }: AdminImportDialogProps) {
  const { t } = useTranslation("admin");
  const fileRef = useRef<HTMLInputElement>(null);
  const changedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [rows, setRows] = useState<InviteRowInput[]>([]);
  const [preview, setPreview] = useState<AdminInvitePreviewRow[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<AdminInviteRowResult[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [recent, setRecent] = useState<InviteBatch[]>([]);
  const [resumeInput, setResumeInput] = useState("");
  const [resumeRows, setResumeRows] = useState<InviteBatchRow[]>([]);
  const [resumeBatchId, setResumeBatchId] = useState<string | null>(null);

  const reset = () => {
    setStep("form");
    setRows([]);
    setPreview([]);
    setAccepted(new Set());
    setResults([]);
    setBatchId(null);
    setResumeRows([]);
    setResumeBatchId(null);
    setResumeInput("");
    if (fileRef.current) fileRef.current.value = "";
  };

  useEffect(() => {
    if (open) {
      reset();
      fetchRecentInviteBatches().then(setRecent).catch(() => {});
    }
  }, [open]);

  const close = () => {
    onOpenChange(false);
    if (changedRef.current) {
      changedRef.current = false;
      onDone?.();
    }
  };

  const fail = (key: string, err: unknown) =>
    toast.error(t(key), { description: err instanceof Error ? err.message : undefined });

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      { "Full name": "Jane Doe", Email: "jane@example.com", Role: "learner", Programme: "", Cohort: "Cohort A", Organization: "" },
      { "Full name": "Alex Coach", Email: "alex@example.com", Role: "coach", Programme: "", Cohort: "", Organization: "" },
      { "Full name": "Sam Sponsor", Email: "sam@example.com", Role: "sponsor", Programme: "", Cohort: "", Organization: "Acme Corp" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "People");
    XLSX.writeFile(wb, "people-import-template.xlsx");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
      const normalized = parsed
        // Role is a required column: a blank cell must surface as invalid_role.
        .map((r) => normalizeSheetRow(r))
        .filter((r) => r.email || r.full_name);
      if (!normalized.length) {
        toast.error(t("importUsers.emptyFile"));
        return;
      }
      const result = await previewAdminInvite(normalized);
      setRows(normalized);
      setPreview(result);
      setAccepted(new Set(result.filter((p) => p.offer).map((p) => p.row_index)));
      setStep("preview");
    } catch (err) {
      fail("importUsers.previewFailed", err);
    } finally {
      setBusy(false);
    }
  };

  const executableCount = preview.filter((p) => isExecutableRow(p, accepted)).length;

  const confirmImport = async () => {
    setBusy(true);
    try {
      const request = rows.map((r, i) => ({ ...r, accept_existing: accepted.has(i) }));
      const run = await executeAdminInvite(request, { track: true });
      setBatchId(run.batch_id);
      setResults(run.results);
      setRows(request);
      setStep("results");
      changedRef.current = true;
      fetchRecentInviteBatches().then(setRecent).catch(() => {});
    } catch (err) {
      fail("importUsers.importFailed", err);
    } finally {
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    if (!batchId) return;
    const failed = results.filter((r) => r.status === "failed");
    if (!failed.length) return;
    setBusy(true);
    try {
      const run = await executeAdminInvite(
        failed.map((r) => ({ ...rows[r.row_index], row_id: r.row_id })),
        { track: true, batchId },
      );
      // The server numbers a retry 0..n-1; map back onto the original rows.
      const byIndex = new Map(results.map((r) => [r.row_index, r]));
      run.results.forEach((r, i) => byIndex.set(failed[i].row_index, { ...r, row_index: failed[i].row_index }));
      setResults([...byIndex.values()].sort((a, b) => a.row_index - b.row_index));
      changedRef.current = true;
    } catch (err) {
      fail("importUsers.importFailed", err);
    } finally {
      setBusy(false);
    }
  };

  const loadBatch = async (id: string) => {
    try {
      setResumeRows(await fetchInviteBatchRows(id));
      setResumeBatchId(id);
      setStep("resume");
    } catch (err) {
      fail("importUsers.couldNotLoadBatch", err);
    }
  };

  const resumable = resumeRows.filter((r) => r.status === "pending" || r.status === "failed");
  const resume = async () => {
    if (!resumeBatchId || !resumable.length) return;
    setBusy(true);
    try {
      await executeAdminInvite(resumable.map(inviteRowFromBatchRow), { track: true, batchId: resumeBatchId });
      await loadBatch(resumeBatchId);
      changedRef.current = true;
    } catch (err) {
      fail("importUsers.importFailed", err);
    } finally {
      setBusy(false);
    }
  };

  const previewCounts = useMemo(() => countBy(preview.map((p) => p.status)), [preview]);
  const resultCounts = useMemo(() => countBy(results.map((r) => r.status)), [results]);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {(step === "preview" || step === "resume") && (
              <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground" aria-label={t("importUsers.back")}>
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {t("importUsers.title")}
          </DialogTitle>
          <DialogDescription>{t("importUsers.description")}</DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {t("importUsers.columnsIntro")} <code>Full name*</code>, <code>Email*</code>, <code>Role*</code>, <code>Programme</code>, <code>Cohort</code>, <code>Organization</code>.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-muted-foreground">
              <li>{t("importUsers.ruleRoles")}</li>
              <li>{t("importUsers.ruleCohort")}</li>
              <li>{t("importUsers.ruleSponsor")}</li>
              <li>{t("importUsers.ruleExisting")}</li>
            </ul>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> {t("importUsers.downloadTemplate")}
            </Button>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onFile}
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground hover:file:bg-primary/90"
              />
              {busy && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("importUsers.validating")}
                </p>
              )}
            </div>
            {recent.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> {t("importUsers.recentBatches")}
                </p>
                <div className="space-y-1">
                  {recent.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => loadBatch(b.id)}
                      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                    >
                      <span className="font-mono text-muted-foreground">{b.id.slice(0, 8)}…</span>
                      <span>{t("importUsers.rowsCount", { count: b.total_rows ?? 0 })}</span>
                      <span className="text-muted-foreground">{format(new Date(b.created_at), "PP p")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={resumeInput}
                onChange={(e) => setResumeInput(e.target.value)}
                placeholder={t("importUsers.batchIdPlaceholder")}
                className="h-8 flex-1 text-xs"
              />
              <Button size="sm" variant="outline" disabled={!resumeInput.trim()} onClick={() => loadBatch(resumeInput.trim())}>
                {t("importUsers.loadBatch")}
              </Button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {Object.entries(previewCounts).map(([status, count]) => (
                <Badge key={status} variant={status === "valid" ? "default" : isProblemStatus(status as PreviewStatus) ? "destructive" : "outline"}>
                  {count} {t(`importUsers.status.${status}`)}
                </Badge>
              ))}
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/60 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">{t("importUsers.person")}</th>
                    <th className="px-2 py-2 text-left">{t("importUsers.role")}</th>
                    <th className="px-2 py-2 text-left">{t("importUsers.enrollment")}</th>
                    <th className="px-2 py-2 text-left">{t("importUsers.statusHeader")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.row_index} className="border-t align-top">
                      <td className="px-2 py-2 text-muted-foreground">{p.row_index + 2}</td>
                      <td className="px-2 py-2">
                        <p className="font-medium">{p.full_name || "—"}</p>
                        <p className="text-muted-foreground">{p.email || "—"}</p>
                      </td>
                      <td className="px-2 py-2">{t(`addPerson.roles.${p.role}`)}</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {[p.programme_name, p.cohort_name, p.organization_name].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={p.status === "valid" ? "default" : isProblemStatus(p.status) ? "destructive" : "outline"} className="text-[10px]">
                          {t(`importUsers.status.${p.status}`)}
                        </Badge>
                        {p.message && <p className="mt-1 text-muted-foreground">{p.message}</p>}
                        {p.offer && (
                          <label className="mt-1 flex cursor-pointer items-center gap-1.5">
                            <Checkbox
                              checked={accepted.has(p.row_index)}
                              onCheckedChange={(v) => {
                                const next = new Set(accepted);
                                if (v) next.add(p.row_index); else next.delete(p.row_index);
                                setAccepted(next);
                              }}
                            />
                            <span>{t(OFFER_LABEL[p.offer])}</span>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">{t("importUsers.previewFooter", { count: executableCount })}</p>
          </div>
        )}

        {step === "results" && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {Object.entries(resultCounts).map(([status, count]) => (
                <Badge key={status} variant={RESULT_TONE[status] ?? "outline"}>{count} {t(`importUsers.result.${status}`)}</Badge>
              ))}
            </div>
            <ResultTable
              rows={results.map((r) => ({ key: String(r.row_index), email: r.email, status: r.status, message: r.message }))}
            />
            {batchId && (
              <p className="text-xs text-muted-foreground">
                {t("importUsers.batchId")} <span className="font-mono">{batchId}</span>
              </p>
            )}
          </div>
        )}

        {step === "resume" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              <span className="font-mono">{resumeBatchId}</span> — {t("importUsers.batchSummary", { total: resumeRows.length, pending: resumable.length })}
            </p>
            <ResultTable rows={resumeRows.map((r) => ({ key: r.id, email: r.email ?? "", status: r.status ?? "pending", message: r.error_message ?? undefined }))} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>{t("importUsers.close")}</Button>
          {step === "preview" && (
            <Button onClick={confirmImport} disabled={busy || executableCount === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("importUsers.confirm", { count: executableCount })}
            </Button>
          )}
          {step === "results" && (resultCounts.failed ?? 0) > 0 && (
            <Button variant="outline" onClick={retryFailed} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("importUsers.retryFailed", { count: resultCounts.failed })}
            </Button>
          )}
          {step === "resume" && resumable.length > 0 && (
            <Button onClick={resume} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("importUsers.resume", { count: resumable.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function ResultTable({ rows }: { rows: { key: string; email: string; status: string; message?: string }[] }) {
  const { t } = useTranslation("admin");
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t("importUsers.email")}</th>
            <th className="px-3 py-2 text-left">{t("importUsers.statusHeader")}</th>
            <th className="px-3 py-2 text-left">{t("importUsers.note")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="px-3 py-2">{r.email}</td>
              <td className="px-3 py-2">
                <Badge variant={RESULT_TONE[r.status] ?? "outline"} className="text-[10px]">
                  {t(`importUsers.result.${r.status}`, { defaultValue: r.status })}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{r.message ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
