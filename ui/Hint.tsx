import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

/** A short label shown on hover or focus, for a control that is only an icon. */
export function Hint({ text, side = "top", children }: { text: string; side?: "top" | "left"; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="hint" side={side} sideOffset={6} collisionPadding={8}>
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
