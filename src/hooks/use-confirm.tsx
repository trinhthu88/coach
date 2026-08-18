import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) — use for delete/reject/remove actions. */
  destructive?: boolean;
}

/**
 * Promise-based, app-styled replacement for the browser's native `confirm()`.
 * Same call shape at the use site (`if (!(await confirm({...}))) return;`),
 * but renders the shared AlertDialog instead of an unstyled, render-blocking
 * native dialog. Render `<ConfirmDialog />` once, anywhere in the component
 * that calls `confirm()`.
 */
export function useConfirm() {
  const { t } = useTranslation("common");
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: boolean) => void>();

  const confirm = useCallback((opts: ConfirmOptions) => {
    // Belt-and-suspenders: the AlertDialog is modal (its overlay covers the full
    // viewport and captures pointer events), so a second confirm() shouldn't be
    // reachable while one is already open — but if it ever is, resolve the
    // orphaned promise instead of silently dropping it.
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const handle = (value: boolean) => {
    resolver.current?.(value);
    setOptions(null);
  };

  const ConfirmDialog = (
    <AlertDialog open={options !== null} onOpenChange={(open) => !open && handle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title}</AlertDialogTitle>
          {options?.description && <AlertDialogDescription>{options.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handle(false)}>
            {options?.cancelLabel ?? t("actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handle(true)}
            className={options?.destructive ? cn(buttonVariants({ variant: "destructive" })) : undefined}
          >
            {options?.confirmLabel ?? t("actions.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, ConfirmDialog };
}
