import type { TFunction } from "i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X } from "lucide-react";
import type { TrainingWeekRow } from "./types";

function PdfField({
  label,
  path,
  uploading,
  onUpload,
  onRemove,
  t,
}: {
  label: string;
  path: string | null | undefined;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  t: (key: string) => string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {path ? (
        <div className="flex items-center justify-between rounded-md border px-2.5 py-2 text-[11px]">
          <span className="truncate">{t("admin.currentFile")}: {path.split("/").pop()}</span>
          <div className="flex shrink-0 items-center gap-1">
            <label className="cursor-pointer text-primary hover:underline">
              {t("admin.replacePdf")}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-[11px] font-medium text-muted-foreground hover:border-primary hover:text-primary">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? t("admin.uploading") : t("admin.uploadPdf")}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      )}
    </div>
  );
}

/** Field form for a single training week — title/subtitle, skill-card HTML, video, unlock date and PDF uploads (EN/VI). */
export function WeekEditor({
  editing,
  setEditing,
  uploading,
  onUploadPdf,
  t,
}: {
  editing: Partial<TrainingWeekRow>;
  setEditing: (w: Partial<TrainingWeekRow>) => void;
  uploading: "en" | "vi" | null;
  onUploadPdf: (file: File, lang: "en" | "vi") => void;
  t: TFunction;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("admin.weekNumberLabel")}</Label>
          <Input
            type="number"
            min={1}
            value={editing.week_number ?? 1}
            onChange={(e) => setEditing({ ...editing, week_number: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
          <div>
            <p className="text-sm font-medium">{t("admin.visibleLabel")}</p>
            <p className="text-[10.5px] text-muted-foreground">{t("admin.visibleHint")}</p>
          </div>
          <Switch checked={!!editing.is_visible} onCheckedChange={(v) => setEditing({ ...editing, is_visible: v })} />
        </div>
      </div>
      <div className="flex items-end justify-between gap-2 rounded-md border p-2.5">
        <div>
          <p className="text-sm font-medium">{t("admin.skillCardVisibleLabel")}</p>
          <p className="text-[10.5px] text-muted-foreground">{t("admin.skillCardVisibleHint")}</p>
        </div>
        <Switch
          checked={editing.skill_card_visible ?? true}
          onCheckedChange={(v) => setEditing({ ...editing, skill_card_visible: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("admin.titleLabel")}</Label>
          <Input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
        </div>
        <div>
          <Label>{t("admin.titleViLabel")}</Label>
          <Input value={editing.title_vi || ""} onChange={(e) => setEditing({ ...editing, title_vi: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{t("admin.subtitleLabel")}</Label>
          <Input value={editing.subtitle || ""} onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })} />
        </div>
        <div>
          <Label>{t("admin.subtitleViLabel")}</Label>
          <Input value={editing.subtitle_vi || ""} onChange={(e) => setEditing({ ...editing, subtitle_vi: e.target.value })} />
        </div>
      </div>
      <div>
        <Label>{t("admin.unlockDateLabel")}</Label>
        <Input
          type="date"
          value={editing.unlock_date || ""}
          onChange={(e) => setEditing({ ...editing, unlock_date: e.target.value || null })}
        />
        <p className="mt-1 text-[10.5px] text-muted-foreground">{t("admin.unlockDateHint")}</p>
      </div>
      <div>
        <Label>{t("admin.skillCardHtmlLabel")}</Label>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          value={editing.skill_card_html || ""}
          onChange={(e) => setEditing({ ...editing, skill_card_html: e.target.value })}
        />
      </div>
      <div>
        <Label>{t("admin.skillCardHtmlViLabel")}</Label>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          value={editing.skill_card_html_vi || ""}
          onChange={(e) => setEditing({ ...editing, skill_card_html_vi: e.target.value })}
        />
      </div>
      <div>
        <Label>{t("admin.videoUrlLabel")}</Label>
        <Input
          value={editing.video_url || ""}
          onChange={(e) => setEditing({ ...editing, video_url: e.target.value })}
          placeholder="https://www.youtube.com/embed/..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <PdfField
          label={t("admin.pdfLabel")}
          path={editing.pdf_storage_path}
          uploading={uploading === "en"}
          onUpload={(f) => onUploadPdf(f, "en")}
          onRemove={() => setEditing({ ...editing, pdf_storage_path: null })}
          t={t}
        />
        <PdfField
          label={t("admin.pdfViLabel")}
          path={editing.pdf_storage_path_vi}
          uploading={uploading === "vi"}
          onUpload={(f) => onUploadPdf(f, "vi")}
          onRemove={() => setEditing({ ...editing, pdf_storage_path_vi: null })}
          t={t}
        />
      </div>
    </>
  );
}
