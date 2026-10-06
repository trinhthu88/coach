import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import type { ProgrammeModuleType } from "@/hooks/useProgrammeModules";
import { ModuleConfigRow, defaultModuleRows, type ModuleRow } from "../AdminProgrammes";

/**
 * Required units are the only programme quantity. The module editor offers no
 * give / receive session limit for any module; Peer shows only the monthly
 * practice limit (Coach opt-in pool, per calendar month), which never caps the
 * Peer requirement (20261006110000, 20261006120000).
 */
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`admin:${key}`, opts) as string;

function renderRow(module: ProgrammeModuleType, row?: ModuleRow) {
  const enabled = { ...(row ?? defaultModuleRows()[module]), enabled: true };
  return render(
    <ModuleConfigRow module={module} row={enabled} onToggle={vi.fn()} onConfigChange={vi.fn()} t={t} trainingWeeks={[]} />,
  );
}

describe("module editor limit fields", () => {
  it.each(["coaching", "mentoring"] as const)("%s shows no session limit field", (module) => {
    renderRow(module);
    expect(screen.queryByText(t("programmes.modules.monthlyPracticeLimit"))).toBeNull();
    expect(screen.queryByText(/give limit|receive limit/i)).toBeNull();
  });

  it("Peer shows only the monthly practice limit, with its stored value", () => {
    const row = defaultModuleRows().peer_coaching;
    renderRow("peer_coaching", { ...row, config: { ...row.config, monthly_limit: 2, give_limit: 9, receive_limit: 9 } });
    expect(screen.getByText(t("programmes.modules.monthlyPracticeLimit"))).toBeInTheDocument();
    expect(screen.queryByText(/give limit|receive limit/i)).toBeNull();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("9")).toBeNull();
  });
});
