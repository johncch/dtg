import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";

const VARIANTS = {
  error: { Icon: CircleAlert, role: "alert" },
  info: { Icon: Info, role: "status" },
} as const;

/** Mosaic's Alert, drawn with dtg's own stylesheet: a neutral card, and only the icon says what kind it is. */
export function Alert({ variant = "error", className, children }: { variant?: keyof typeof VARIANTS; className?: string; children: ReactNode }) {
  const { Icon, role } = VARIANTS[variant];
  return (
    <div role={role} className={["alert", `alert-${variant}`, className].filter(Boolean).join(" ")}>
      <Icon className="alert-icon" size={18} aria-hidden />
      <div className="alert-body">{children}</div>
    </div>
  );
}
