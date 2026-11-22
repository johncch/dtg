import { Lock, LockOpen } from "lucide-react";

export function LockIcon({ locked, size = 14 }: { locked: boolean; size?: number }) {
  const Icon = locked ? Lock : LockOpen;
  return <Icon size={size} aria-hidden />;
}
