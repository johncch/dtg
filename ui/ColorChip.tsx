import { useState, type ReactNode } from "react";
import { formatColor, isOpaque, type Color } from "../src/color-math.js";
import type { EditTarget } from "../src/edit.js";
import { ColorTip } from "./ColorTip.js";
import { paintCss } from "./paint.js";
import { ColorEditor } from "./picker/ColorEditor.js";
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
  named = null,
  children,
}: {
  color: Color;
  /** `regular` where the chip is what the cell is for; `small` where it sits inline with other things. */
  size?: "regular" | "small";
  /** The text beside the swatch; the sRGB value unless the caller has the authored form. */
  label?: string;
  /** Where an authored color is written, which makes the chip open the picker. Derived colors have none. */
  edit?: EditTarget;
  /** The palette color an editable value names, when it names one rather than writing a color. */
  named?: string | null;
  /** Shown under the value and part of the same hover target, e.g. the ref a role points at. */
  children?: ReactNode;
}) {
  const className = ["chip", size === "small" && "chip-small", edit && "chip-editable"].filter(Boolean).join(" ");
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
  if (edit) {
    return (
      <EditableChip color={color} target={edit} named={named} className={className}>
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
  target,
  named = null,
  className,
  children,
}: {
  color: Color;
  target: EditTarget;
  named?: string | null;
  className: string;
  children: ReactNode;
}) {
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
      {({ handle, close }) => <OpenedColorEditor color={color} target={target} named={named} handle={handle} close={close} />}
    </Popup>
  );
}

function OpenedColorEditor({
  color,
  named,
  ...editor
}: { color: Color } & Omit<Parameters<typeof ColorEditor>[0], "original">) {
  // While the picker is open the chip redraws with the color being tried,
  // so what the definition had is taken once, at the moment of opening.
  const [original] = useState(color);
  const [namedAtOpening] = useState(named);
  return <ColorEditor original={original} named={namedAtOpening} {...editor} />;
}
