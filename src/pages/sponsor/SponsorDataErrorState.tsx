import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SponsorDataErrorStateProps {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
}

export function SponsorDataErrorState({
  title,
  description,
  retryLabel,
  onRetry,
}: SponsorDataErrorStateProps) {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-xl flex-col items-center rounded-[24px] border border-destructive/20 bg-destructive/5 px-6 py-12 text-center"
    >
      <AlertTriangle className="h-7 w-7 text-destructive" />
      <h2 className="mt-4 font-display text-2xl font-medium text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Button type="button" variant="outline" className="mt-6" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}