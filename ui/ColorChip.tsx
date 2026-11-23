import type { ReactNode } from "react";
import { formatColor } from "../src/color-math.js";
import type { EditTarget } from "../src/edit.js";
import { ColorFacts, ColorTip } from "./ColorTip.js";
import { LockIcon } from "./LockIcon.js";
import { EDITABLE } from "./mode.js";
import { isGradient, leadColor, paintCss, paintIsOpaque, type Paint } from "./paint.js";
import { usePaletteColors } from "./palette-colors.js";
import { sourcesFor, TargetValueEditor } from "./picker/ValueEditor.js";

/** What a surface tells the editor beyond the value itself: what it can point at, and how. */
type EditorExtras = Partial<Omit<Parameters<typeof TargetValueEditor>[0], "target" | "value" | "color" | "panel">>;
import { Popup } from "./Popup.js";

/**
 * A color as the app shows it everywhere: a swatch, its value, and anything
 * that belongs with it. The whole item is one hover target for the tooltip,
 * and an editable one opens the picker when clicked.
 */
export function ColorChip({
  color,
  size = "regular",
  label = isGradient(color) ? color.ref : formatColor(color, "srgb"),
  value = label,
  edit,
  editor,
  reference,
  className: extra,
  onUnlock,
  children,
}: {
  color: Paint;
  /** `regular` where the chip is what the cell is for; `small` where it sits inline with other things. */
  size?: "regular" | "small";
  /** The text beside the swatch; the sRGB value unless the caller has the authored form. */
  label?: string;
  /** What the editor opens on, where that is not the label: a role that inherits shows the ref it takes but is written as nothing. */
  value?: string;
  /** Where an authored color is written, which makes the chip open the editor. Derived colors have none. */
  edit?: EditTarget;
  editor?: EditorExtras;
  /** Shown in the tooltip under the color's name: the ref it comes from. */
  reference?: ReactNode;
  className?: string;
  /** Given while an editable color is locked; see `EditableChip`. */
  onUnlock?: () => void;
  /** Shown under the value and part of the same hover target, e.g. the ref a role points at. */
  children?: ReactNode;
}) {
  const className = ["chip", size === "small" && "chip-small", edit && EDITABLE && "chip-editable", extra].filter(Boolean).join(" ");
  const content = (
    <>
      <span className={paintIsOpaque(color) ? "swatch" : "swatch swatch-alpha"}>
        <span className="swatch-color" style={{ background: paintCss(color) }} />
      </span>
      {children ? (
        <span>
          <code>{label}</code> {children}
        </span>
      ) : (
        <code>{label}</code>
      )}
    </>
  );
  if (edit && EDITABLE) {
    return (
      <EditableChip color={color} value={value} target={edit} className={className} editor={editor} reference={reference} onUnlock={onUnlock}>
        {content}
      </EditableChip>
    );
  }
  return (
    <ColorTip color={color} reference={reference}>
      <span className={className}>{content}</span>
    </ColorTip>
  );
}

export function EditableChip({
  color,
  value = isGradient(color) ? color.ref : formatColor(color, "srgb"),
  target,
  className,
  tipInside = false,
  editor,
  reference,
  onUnlock,
  children,
}: {
  color: Paint;
  /** The value as written, which the editor opens on. */
  value?: string;
  target: EditTarget;
  className: string;
  /** Opens the hover tooltip over the chip, for one large enough to hold it. */
  tipInside?: boolean;
  editor?: EditorExtras;
  reference?: ReactNode;
  /** Given while the color is locked: the panel then shows the color and offers this, and becomes the editor once it is no longer given. */
  onUnlock?: () => void;
  children: ReactNode;
}) {
  const constants = usePaletteColors();
  return (
    <Popup
      title={isGradient(color) ? "Edit gradient" : "Edit color"}
      className={className}
      label={children}
      // Nothing in the picker is the obvious thing to type into, and a focus
      // ring on its first control would say it is.
      focus="panel"
      wrap={(button, open) => (
        <ColorTip color={color} reference={reference} suppressed={open} inside={tipInside}>
          {button}
        </ColorTip>
      )}
    >
      {(panel) =>
        onUnlock ? (
          <div className="ref-editor">
            <div className="editor-head" {...panel.handle}>
              <span className="ref-editor-heading locked-heading">
                <LockIcon locked />
                Locked –
                <button type="button" className="locked-unlock" onClick={onUnlock}>
                  unlock to edit
                </button>
              </span>
              {panel.close}
            </div>
            <ColorFacts color={color} />
          </div>
        ) : (
          <TargetValueEditor
            target={target}
            value={value}
            color={leadColor(color)}
            sources={sourcesFor(target)}
            gradient={isGradient(color) ? color : null}
            constants={constants}
            {...editor}
            panel={panel}
          />
        )
      }
    </Popup>
  );
}
