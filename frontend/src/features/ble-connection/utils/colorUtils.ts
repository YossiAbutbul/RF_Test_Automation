// frontend/src/features/ble-connection/utils/colorUtils.ts

interface HSL {
  hue: number;
  s: number;
  l: number;
}

export interface ColorPalette {
  bg: string;
  border: string;
  text: string;
}

/**
 * Deterministic color generation from string
 * Same input always produces same color
 */
function hslFromLabel(label: string): HSL {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const s = 65;
  const l = 46;
  return { hue, s, l };
}

/**
 * Generate color palette for nickname badges
 * Returns background, border, and text colors
 */
export function tagPalette(label: string): ColorPalette {
  const { hue, s, l } = hslFromLabel(label);
  return {
    bg: `hsla(${hue}deg, ${s}%, ${l}%, 0.12)`,
    border: `hsla(${hue}deg, ${s}%, ${l}%, 0.35)`,
    text: l >= 60 ? "#1f2937" : "#111111",
  };
}