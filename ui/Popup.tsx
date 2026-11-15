import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, useState, type HTMLAttributes, type PointerEvent, type ReactElement, type ReactNode } from "react";

type Point = { x: number; y: number };

type Placement = { open: false } | { open: true; at: Point };

const EDGE = 8;
const GAP = 6;
const POINTER_GAP = 20;

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
  /** Whether the panel was closed with Escape, for contents that take that as "not this". Read as they unmount. */
  escaped(): boolean;
};


/**
 * A button that opens a small movable panel beside the pointer that clicked
 * it, or beside itself when opened from the keyboard. The panel's
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
  const escaped = useRef(false);
  const clickedAt = useRef<Point | null>(null);
  const resized = useRef<ResizeObserver | null>(null);

  const keepOnScreen = () =>
    setPlacement((current) => {
      if (!current.open || !panel.current) return current;
      const at = withinViewport(current.at, panel.current.getBoundingClientRect());
      return at.x === current.at.x && at.y === current.at.y ? current : { open: true, at };
    });

  // Right of and below the pointer, or below the button when the keyboard
  // opened it; on the other side when that runs off the screen, or as near
  // as fits. Run from the panel's ref rather than an effect on opening,
  // because the portal mounts the panel a render after the dialog opens; and
  // once only, so a panel that has been dragged is not put back.
  const settle = (element: HTMLDivElement | null) => {
    if (element !== panel.current) {
      resized.current?.disconnect();
      resized.current = element ? new ResizeObserver(keepOnScreen) : null;
      if (element) resized.current!.observe(element);
    }
    panel.current = element;
    if (!element || !placement.open || !unplaced.current) return;
    unplaced.current = false;
    const box = element.getBoundingClientRect();
    const anchor = button.current!.getBoundingClientRect();
    const pointer = clickedAt.current;
    const right = pointer ? pointer.x + POINTER_GAP : anchor.left;
    const left = pointer ? pointer.x - POINTER_GAP - box.width : anchor.left;
    const below = pointer ? pointer.y + POINTER_GAP : anchor.bottom + GAP;
    const above = (pointer ? pointer.y - POINTER_GAP : anchor.top - GAP) - box.height;
    const x = right + box.width <= innerWidth - EDGE || left < EDGE ? right : left;
    const y = below + box.height <= innerHeight - EDGE || above < EDGE ? below : above;
    const at = withinViewport({ x, y }, box);
    if (at.x !== placement.at.x || at.y !== placement.at.y) setPlacement({ open: true, at });
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setPlacement({ open: false });
      return;
    }
    const anchor = button.current!.getBoundingClientRect();
    const pointer = clickedAt.current;
    unplaced.current = true;
    escaped.current = false;
    setPlacement({ open: true, at: pointer ? { x: pointer.x + POINTER_GAP, y: pointer.y + POINTER_GAP } : { x: anchor.left, y: anchor.bottom + GAP } });
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
          <button
            type="button"
            className={className}
            ref={button}
            // A click made from the keyboard has no pointer position; detail counts pointer clicks.
            onClick={(event) => { clickedAt.current = event.detail > 0 ? { x: event.clientX, y: event.clientY } : null; }}
          >
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
            onEscapeKeyDown={() => {
              escaped.current = true;
            }}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children({
              handle,
              escaped: () => escaped.current,
              close: (
                <Dialog.Close asChild>
                  <button type="button" className="editor-close" aria-label="Close" title="Close">
                    <X size={16} aria-hidden />
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
