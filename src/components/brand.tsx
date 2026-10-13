import Image from "next/image";
import { useId } from "react";

// Brand marks: shield mark + wordmark from /public. Decorative bands still use
// Dhaka weaving; the skyline uses the Himalaya motif.

export function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/agent_favicon.png"
      alt="AgentGuard"
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}

export function Wordmark({ tone = "dark", size = 34 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Logo size={size} />
      <span className={`font-display text-[1.2rem] font-semibold tracking-tight ${tone === "light" ? "text-white" : "text-himal-900"}`}>
        Agent<span className={tone === "light" ? "text-himal-300" : "text-himal-500"}>Guard</span>
      </span>
    </span>
  );
}

const PALETTES = {
  // on the deep blue of the sidebar and hero
  night: { outer: "#dc143c", inner: "#f5a300", core: "#ffffff", accent: "#7fa6e6", ground: "transparent" },
  // on paper
  paper: { outer: "#dc143c", inner: "#003893", core: "#f5a300", accent: "#d6cab8", ground: "transparent" },
} as const;

/**
 * A strip of Dhaka weave: stepped diamonds, built from square "threads" the way
 * the cloth is. `cell` is the size of one thread in pixels.
 */
export function DhakaBand({ tone = "paper", cell = 2, className }: { tone?: keyof typeof PALETTES; cell?: number; className?: string }) {
  const id = useId();
  const c = PALETTES[tone];
  const cols = 12;
  const rows = 9;
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  const diamond = (half: number, fill: string) => {
    for (let dy = -half; dy <= half; dy++) {
      const w = 2 * (half - Math.abs(dy)) + 1;
      rects.push({ x: 5 - (w - 1) / 2, y: 4 + dy, w, fill });
    }
  };
  diamond(4, c.outer);
  diamond(2, c.inner);
  diamond(0, c.core);
  // the small cross woven between diamonds
  rects.push({ x: 11, y: 3, w: 1, fill: c.accent }, { x: 10, y: 4, w: 3, fill: c.accent }, { x: 11, y: 5, w: 1, fill: c.accent });
  // The cross straddles the tile edge, so the last column wraps to the first.
  rects.push({ x: -2, y: 4, w: 3, fill: c.accent });

  return (
    <svg className={className} width="100%" height={rows * cell} aria-hidden="true" preserveAspectRatio="xMinYMid slice">
      <defs>
        <pattern id={id} width={cols * cell} height={rows * cell} patternUnits="userSpaceOnUse">
          {rects.map((r, i) => (
            <rect key={i} x={r.x * cell} y={r.y * cell} width={r.w * cell} height={cell} fill={r.fill} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A layered Himalayan skyline. Sits at the bottom of dark panels. */
export function Himalaya({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 160" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true">
      <path d="M0 160V118l48-34 30 22 52-58 34 40 26-22 44 46 40-70 30 34 22-18 44 52 38-44 46 50 36-30 60 52v40Z" fill="#17306b" />
      <path d="M130 48l-16 18 12 6 8-10 10 12 8-6ZM274 44l-14 24 10 4 8-12 8 10 8-6Z" fill="#c5d5f3" opacity="0.700" />
      <path d="M0 160v-22l60-40 44 30 40-26 52 40 58-52 46 38 34-20 56 44 50-36 66 46 94-34v72Z" fill="#102451" />
      <path d="M0 160v-10l80-30 70 22 90-34 80 30 100-28 90 26 90-18v42Z" fill="#0b1b3f" />
    </svg>
  );
}
