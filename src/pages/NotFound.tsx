import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import clarivaLogo from "@/assets/clariva-logo-dark.png";

const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation("common");

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-secondary px-6 text-secondary-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.14), transparent 70%)" }}
      />
      <div className="relative z-10 flex flex-col items-center text-center">
        <img src={clarivaLogo} alt="Clariva" className="h-8 w-auto object-contain" />
        <div className="mt-10 inline-flex items-center gap-2.5 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-glow">
          <Compass className="h-3.5 w-3.5" />
          {t("notFound.badge")}
        </div>
        <h1 className="mt-6 font-display text-[clamp(48px,8vw,88px)] font-light leading-none tracking-tight text-white">
          404
        </h1>
        <p className="mt-4 max-w-md text-[15px] leading-[1.7] text-white/50">
          {t("notFound.body")}
        </p>
        <Button asChild size="lg" className="mt-8 rounded-full shadow-glow">
          <Link to="/">{t("notFound.returnHome")}</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
