import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function ComingSoon({ title, description }: { title: string; description?: string }) {
  const { t } = useTranslation("common");
  return (
    <Card className="flex flex-col items-center gap-4 p-8 text-center sm:p-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Construction className="h-6 w-6" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-md text-muted-foreground">
        {description ?? t("comingSoon.defaultDescription")}
      </p>
    </Card>
  );
}
