import type { ReactNode } from "react";
import { formatColor, isOpaque, type Color } from "../src/color-math.js";
import type { EditTarget } from "../src/edit.js";
import { ColorTip } from "./ColorTip.js";
import { EDITABLE } from "./mode.js";
import { paintCss } from "./paint.js";
import { usePaletteColors } from "./palette-colors.js";
import { sourcesFor, TargetValueEditor } from "./picker/ValueEditor.js";
import { Popup } from "./Popup.js";

/**
 * A color as the app shows it everywhere: a swatch, its value, and anything
 * that belongs with it. The whole item is one hover target for the tooltip,
 * and an editable one opens the picker when clicked.
 */
export function ColorChip({
  color,
  size = "regular",
  label = formatColor(color, "srgb"),
  edit,
  children,
}: {
  color: Color;
  /** `regular` where the chip is what the cell is for; `small` where it sits inline with other things. */
  size?: "regular" | "small";
  /** The text beside the swatch; the sRGB value unless the caller has the authored form. */
  label?: string;
  /** Where an authored color is written, which makes the chip open the editor. Derived colors have none. */
  edit?: EditTarget;
  /** Shown under the value and part of the same hover target, e.g. the ref a role points at. */
  children?: ReactNode;
}) {
  const className = ["chip", size === "small" && "chip-small", edit && EDITABLE && "chip-editable"].filter(Boolean).join(" ");
  const content = (
    <>
      <span className={isOpaque(color) ? "swatch" : "swatch swatch-alpha"}>
        <span className="swatch-color" style={{ background: paintCss(color) }} />
      </span>
      {children ? (
        <span>
          <code>{label}</code>
          <br />
          {children}
        </span>
      ) : (
        <code>{label}</code>
      )}
    </>
  );
  if (edit && EDITABLE) {
    return (
      <EditableChip color={color} value={label} target={edit} className={className}>
        {content}
      </EditableChip>
    );
  }
  return (
    <ColorTip color={color}>
      <span className={className}>{content}</span>
    </ColorTip>
  );
}

export function EditableChip({
  color,
  value = formatColor(color, "srgb"),
  target,
  className,
  children,
}: {
  color: Color;
  /** The value as written, which the editor opens on. */
  value?: string;
  target: EditTarget;
  className: string;
  children: ReactNode;
}) {
  const constants = usePaletteColors();
  return (
    <Popup
      title="Edit color"
      className={className}
      label={children}
      // Nothing in the picker is the obvious thing to type into, and a focus
      // ring on its first control would say it is.
      focus="panel"
      wrap={(button, open) => (
        <ColorTip color={color} suppressed={open}>
          {button}
        </ColorTip>
      )}
    >
      {(panel) => (
        <TargetValueEditor target={target} value={value} color={color} sources={sourcesFor(target)} constants={constants} panel={panel} />
      )}
    </Popup>
  );
}
