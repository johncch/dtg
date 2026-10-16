import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState, type HTMLAttributes, type PointerEvent, type ReactElement, type ReactNode } from "react";

type Point = { x: number; y: number };

type Placement = { open: false } | { open: true; at: Point };

const EDGE = 8;
const GAP = 6;

function withinViewport(at: Point, panel: DOMRect): Point {
  return {
    x: Math.min(Math.max(EDGE, at.x), Math.max(EDGE, innerWidth - panel.width - EDGE)),
    y: Math.min(Math.max(EDGE, at.y), Math.max(EDGE, innerHeight - panel.height - EDGE)),
  };
}

export type PopupPanel = {
  /** Pointer handlers that make an element the grip the panel is dragged by. */
  handle: HTMLAttributes<HTMLDivElement>;
  /** The panel's close control. */
  close: ReactNode;
  dismiss(): void;
};

/**
 * A button that opens a small movable panel beside itself. The panel's
 * contents are mounted when it opens and unmounted when it closes, so they
 * can take what they need at the moment of opening and act on dismissal.
 */
export function Popup({
  title,
  className,
  label,
  wrap = (button) => button,
  focus,
  children,
}: {
  /** Read out for the panel; not shown. */
  title: string;
  className: string;
  /** What the button shows. */
  label: ReactNode;
  /** Puts something around the button, such as a tooltip that should stand down while the panel is open. */
  wrap?: (button: ReactElement, open: boolean) => ReactNode;
  /** Where focus lands on opening: the panel itself, or the first field in it to type into. */
  focus: "panel" | "field";
  children: (panel: PopupPanel) => ReactNode;
}) {
  const [placement, setPlacement] = useState<Placement>({ open: false });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const unplaced = useRef(false);

  // Below the button, unless that runs off the screen: then above it, or as
  // near as fits. Run from the panel's ref rather than an effect on opening,
  // because the portal mounts the panel a render after the dialog opens; and
  // once only, so a panel that has been dragged is not put back.
  const settle = (element: HTMLDivElement | null) => {
    panel.current = element;
    if (!element || !placement.open || !unplaced.current) return;
    unplaced.current = false;
    const box = element.getBoundingClientRect();
    const anchor = button.current!.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - box.height;
    const y = below + box.height <= innerHeight - EDGE || above < EDGE ? below : above;
    const at = withinViewport({ x: anchor.left, y }, box);
    if (at.x !== placement.at.x || at.y !== placement.at.y) setPlacement({ open: true, at });
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setPlacement({ open: false });
      return;
    }
    const anchor = button.current!.getBoundingClientRect();
    unplaced.current = true;
    setPlacement({ open: true, at: { x: anchor.left, y: anchor.bottom + GAP } });
  };

  const grip = useRef<Point | null>(null);
  const handle = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!placement.open || (event.target as Element).closest("button, input, select")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      grip.current = { x: event.clientX - placement.at.x, y: event.clientY - placement.at.y };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!placement.open || !grip.current) return;
      const at = withinViewport(
        { x: event.clientX - grip.current.x, y: event.clientY - grip.current.y },
        panel.current!.getBoundingClientRect(),
      );
      setPlacement({ open: true, at });
    },
    onPointerUp: () => {
      grip.current = null;
    },
    onPointerCancel: () => {
      grip.current = null;
    },
  };

  return (
    <Dialog.Root open={placement.open} onOpenChange={onOpenChange} modal={false}>
      {wrap(
        <Dialog.Trigger asChild>
          <button type="button" className={className} ref={button}>
            {label}
          </button>
        </Dialog.Trigger>,
        placement.open,
      )}
      <Dialog.Portal>
        {placement.open && (
          <Dialog.Content
            ref={settle}
            className="popover"
            style={{ left: placement.at.x, top: placement.at.y }}
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const field = focus === "field" ? panel.current?.querySelector<HTMLInputElement>('input[type="text"], input[type="number"]') : null;
              if (field) field.select();
              else panel.current?.focus();
            }}
            // A click outside closes it; focus merely landing outside does not,
            // which happens when a panel that just closed hands focus back to
            // its button after this one has opened.
            onFocusOutside={(event) => event.preventDefault()}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children({
              handle,
              close: (
                <Dialog.Close asChild>
                  <button type="button" className="editor-close" aria-label="Close" title="Close">
                    ×
                  </button>
                </Dialog.Close>
              ),
              dismiss: () => setPlacement({ open: false }),
            })}
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
