import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  /** Where to go when there is no in-app history (deep link / hard refresh). */
  fallbackTo: string;
  label?: string;
  variant?: "outline" | "ghost";
  className?: string;
}

/**
 * Shared back navigation. Prefers the browser/router history so the user
 * returns exactly where they came from; falls back to a sensible route when
 * the page was opened directly.
 */
export function BackButton({
  fallbackTo,
  label = "Back",
  variant = "outline",
  className,
}: BackButtonProps) {
  const router = useRouter();

  const goBack = () => {
    const canGoBack =
      typeof window !== "undefined" &&
      window.history.length > 1 &&
      (router.history.canGoBack?.() ?? true);
    if (canGoBack) router.history.back();
    else router.navigate({ to: fallbackTo as never });
  };

  return (
    <Button variant={variant} size="sm" onClick={goBack} className={className}>
      <ArrowLeft className="h-4 w-4 mr-1" /> {label}
    </Button>
  );
}
