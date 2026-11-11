// Pen strokes: the hand-drawn marks around the screens. Each is one small SVG drawn
// in the current text colour (set `color` in CSS to change the pen). They're
// decoration, so they're hidden from screen readers. `draw` makes the stroke draw
// itself once when it appears (see .doodle.draw in index.css).

type Props = { className?: string; draw?: boolean };

function Stroke({
  name,
  viewBox,
  d,
  stretch = false,
  className = "",
  draw = false,
}: Props & { name: string; viewBox: string; d: string[]; stretch?: boolean }) {
  return (
    <svg
      className={`doodle doodle-${name}${draw ? " draw" : ""} ${className}`}
      viewBox={viewBox}
      preserveAspectRatio={stretch ? "none" : undefined}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.map((path, i) => (
        <path key={i} d={path} pathLength={1} style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
    </svg>
  );
}

// A wavy underline that stretches to the words above it.
export function Squiggle(props: Props) {
  return (
    <Stroke
      {...props}
      name="squiggle"
      viewBox="0 0 200 16"
      stretch
      d={["M3 10 C 18 2, 34 15, 52 8 S 86 2, 106 9 S 144 14, 164 6 S 188 5, 197 9"]}
    />
  );
}

// Two quick pen lines under something, the way you'd underline a total twice.
export function DoubleLine(props: Props) {
  return (
    <Stroke
      {...props}
      name="double"
      viewBox="0 0 200 16"
      stretch
      d={["M4 5 Q 58 1 118 4 T 196 3", "M12 12 Q 80 8 146 11 T 188 10"]}
    />
  );
}

// A loop drawn round something, overshooting where the pen came back.
export function Loop(props: Props) {
  return (
    <Stroke
      {...props}
      name="loop"
      viewBox="0 0 200 80"
      stretch
      d={[
        "M 34 12 C 84 0, 162 4, 188 30 C 204 56, 150 77, 96 76 C 40 76, 2 60, 8 36 C 12 16, 62 5, 122 8 C 152 9, 178 17, 192 28",
      ]}
    />
  );
}

// A curly arrow from a handwritten note to the thing it's about.
export function Arrow(props: Props) {
  return (
    <Stroke
      {...props}
      name="arrow"
      viewBox="0 0 120 90"
      d={["M8 8 C 14 52, 52 30, 48 52 C 45 68, 30 58, 44 46 C 62 32, 84 66, 108 72", "M92 60 L109 73 L90 82"]}
    />
  );
}

// A big tick, the kind you put next to something that's done.
export function Tick(props: Props) {
  return <Stroke {...props} name="tick" viewBox="0 0 100 64" d={["M8 34 C 16 40, 22 50, 29 58 C 40 36, 62 14, 92 6"]} />;
}

// A five-point star done in one go, not quite closed.
export function Star(props: Props) {
  return (
    <Stroke
      {...props}
      name="star"
      viewBox="0 0 100 100"
      d={["M50 7 L62 39 L95 37 L68 58 L80 93 L49 72 L21 92 L33 57 L6 40 L40 39 L51 8"]}
    />
  );
}

// A little burst of short lines.
export function Sparkle(props: Props) {
  return (
    <Stroke
      {...props}
      name="sparkle"
      viewBox="0 0 60 60"
      d={["M30 4 V18", "M30 42 V56", "M4 30 H18", "M42 30 H56", "M12 12 L20 20", "M40 40 L48 48", "M48 12 L40 20", "M20 40 L12 48"]}
    />
  );
}

// A coin: a wobbly circle with a dollar sign.
export function Coin(props: Props) {
  return (
    <Stroke
      {...props}
      name="coin"
      viewBox="0 0 100 100"
      d={[
        "M52 8 C 78 8, 93 28, 92 51 C 91 76, 72 92, 49 92 C 25 92, 8 74, 8 50 C 8 26, 26 9, 54 9",
        "M62 36 C 56 28, 38 30, 38 41 C 38 52, 63 48, 63 60 C 63 71, 43 73, 36 64",
        "M50 24 V78",
      ]}
    />
  );
}

// A patch scribbled in with a marker: one zigzag going back and forth across a box.
// The wobble is worked out from `seed`, so the same patch always looks the same.
export function Scribble({ className = "", seed = 1, rows = 9 }: { className?: string; seed?: number; rows?: number }) {
  let state = seed * 9301 + 49297;
  const wobble = (size: number) => {
    state = (state * 9301 + 49297) % 233280;
    return (state / 233280 - 0.5) * size;
  };
  const points: string[] = [];
  for (let row = 0; row <= rows; row++) {
    const y = 8 + (84 * row) / rows;
    const left = `${(6 + wobble(8)).toFixed(1)} ${(y + 5 + wobble(5)).toFixed(1)}`;
    const right = `${(94 + wobble(8)).toFixed(1)} ${(y - 5 + wobble(5)).toFixed(1)}`;
    points.push(row % 2 === 0 ? left : right, row % 2 === 0 ? right : left);
  }
  return (
    <svg
      className={`doodle doodle-scribble ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={`M${points.join(" L")}`} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
