/** Tiny utility glyphs used inside primitives (search, close). Same family
 *  rules as the category set: 16 grid, 1.5 stroke, squared terminals. */

type GlyphProps = { className?: string };

function Glyph({ d, className }: GlyphProps & { d: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function SearchGlyph({ className }: GlyphProps) {
  return (
    <Glyph
      d="M2.75 7 A4.25 4.25 0 1 0 11.25 7 A4.25 4.25 0 1 0 2.75 7 M10.2 10.2 L13.6 13.6"
      className={className}
    />
  );
}

export function CloseGlyph({ className }: GlyphProps) {
  return <Glyph d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" className={className} />;
}
