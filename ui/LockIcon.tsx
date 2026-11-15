import { Lock, LockOpen } from "lucide-react";

export function LockIcon({ locked }: { locked: boolean }) {
  const Icon = locked ? Lock : LockOpen;
  return <Icon size={12} aria-hidden />;
}
