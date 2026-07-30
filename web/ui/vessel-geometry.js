// ─────────────────────────────────────────────────────────────────────
// web/ui/vessel-geometry.js
// Water-tracker vessel silhouettes. Plain-JS port of the native app's
// lib/vesselGeometry.ts — same coordinates, same paths, so both apps draw
// the identical vessel. Pure data + a string serializer, no DOM.
//
// Decorations (tumbler handle, wine stem/base, pool floaty/ladder) are a
// small primitive-shape list so one definition serializes to SVG markup.
// ─────────────────────────────────────────────────────────────────────

export const VESSEL_GEOMETRY = {
    glass: {
        viewBox: [64, 138], display: [44, 95],
        outlinePath: 'M 3,18 L 61,18 C 59,56 55,92 52,124 Q 51,134 43,134 L 21,134 Q 13,134 12,124 C 9,92 5,56 3,18 Z',
        fillClipPath: 'M 3,18 L 61,18 C 59,56 55,92 52,124 Q 51,134 43,134 L 21,134 Q 13,134 12,124 C 9,92 5,56 3,18 Z',
        fillTop: 18, fillBottom: 134, centerX: 32,
    },
    bottle: {
        viewBox: [60, 160], display: [38, 101],
        outlinePath: 'M 20,18 L 40,18 L 40,46 C 40,52 50,58 53,68 L 53,144 Q 53,156 42,156 L 18,156 Q 7,156 7,144 L 7,68 C 10,58 20,52 20,46 Z',
        fillClipPath: 'M 20,18 L 40,18 L 40,46 C 40,52 50,58 53,68 L 53,144 Q 53,156 42,156 L 18,156 Q 7,156 7,144 L 7,68 C 10,58 20,52 20,46 Z',
        fillTop: 18, fillBottom: 156, centerX: 30,
    },
    jar: {
        viewBox: [70, 146], display: [46, 96],
        outlinePath: 'M 6,38 L 64,38 C 67,62 67,102 65,126 Q 64,142 53,142 L 17,142 Q 6,142 5,126 C 3,102 3,62 6,38 Z',
        fillClipPath: 'M 6,38 L 64,38 C 67,62 67,102 65,126 Q 64,142 53,142 L 17,142 Q 6,142 5,126 C 3,102 3,62 6,38 Z',
        fillTop: 38, fillBottom: 142, centerX: 35,
    },
    tumbler: {
        viewBox: [80, 174], display: [46, 100],
        outlinePath: 'M 5,44 L 51,44 L 46,150 Q 46,158 37,158 L 16,158 Q 8,158 8,150 Z',
        fillClipPath: 'M 5,44 L 51,44 L 46,150 Q 46,158 37,158 L 16,158 Q 8,158 8,150 Z',
        fillTop: 44, fillBottom: 158, centerX: 28,
        // Lid + straw removed (the straw was drawn poking out through the lid,
        // so it can't stay without something to poke through) — handle only now.
        decorations: [
            { t: 'path', d: 'M 60,56 Q 74,56 74,70 Q 74,84 62,84', stroke: '#8a97a0', sw: 4, cap: 'round' },
        ],
    },
    wineglass: {
        viewBox: [80, 137], display: [48, 82],
        outlinePath: 'M 3,22 C 3,52 14,72 34,76 C 54,72 65,52 65,22 Z',
        fillClipPath: 'M 3,22 C 3,52 14,72 34,76 C 54,72 65,52 65,22 Z',
        fillTop: 22, fillBottom: 72, centerX: 34,
        decorations: [
            { t: 'rect', x: 31, y: 76, w: 6, h: 52, fill: '#c7cfd4' },
            { t: 'ellipse', cx: 34, cy: 132, rx: 24, ry: 5, fill: '#c7cfd4' },
        ],
    },
    pool: {
        viewBox: [160, 104], display: [92, 60],
        outlinePath: 'M 10,18 L 150,18 Q 158,18 158,26 L 158,62 Q 158,70 150,70 L 10,70 Q 2,70 2,62 L 2,26 Q 2,18 10,18 Z',
        fillClipPath: 'M 10,18 L 150,18 Q 158,18 158,26 L 158,62 Q 158,70 150,70 L 10,70 Q 2,70 2,62 L 2,26 Q 2,18 10,18 Z',
        fillTop: 18, fillBottom: 70, centerX: 80,
        decorations: [
            { t: 'circle', cx: 118, cy: 34, r: 11, stroke: '#ff9f43', sw: 4 },
            { t: 'circle', cx: 118, cy: 34, r: 5, fill: '#eaf4fd' },
            { t: 'line', x1: 4, y1: 80, x2: 4, y2: 94, stroke: '#8a97a0', sw: 3 },
            { t: 'line', x1: 16, y1: 80, x2: 16, y2: 94, stroke: '#8a97a0', sw: 3 },
            { t: 'line', x1: 2, y1: 86, x2: 18, y2: 86, stroke: '#8a97a0', sw: 3 },
        ],
    },
};

export const VESSEL_IDS = Object.keys(VESSEL_GEOMETRY);

export const VESSEL_LABELS = {
    glass:     'Glass',
    bottle:    'Bottle',
    jar:       'Mason jar',
    tumbler:   'Tumbler',
    wineglass: 'Wine glass',
    pool:      'Pool',
};

/** Serialize a primitive-shape list to SVG markup. */
export function shapesToSvg(shapes) {
    return (shapes || [])
        .map((s) => {
            const stroke = s.stroke ? ` stroke="${s.stroke}"` : '';
            const sw     = s.sw != null ? ` stroke-width="${s.sw}"` : '';
            const cap    = s.cap ? ` stroke-linecap="${s.cap}"` : '';
            switch (s.t) {
                case 'rect': {
                    const rx = s.rx != null ? ` rx="${s.rx}"` : '';
                    return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"${rx} fill="${s.fill ?? 'none'}"${stroke}${sw}/>`;
                }
                case 'line':
                    return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"${stroke} stroke-width="${s.sw}"${cap}/>`;
                case 'circle':
                    return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill ?? 'none'}"${stroke}${sw}/>`;
                case 'ellipse':
                    return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${s.fill ?? 'none'}"${stroke}${sw}/>`;
                case 'path':
                    return `<path d="${s.d}" fill="${s.fill ?? 'none'}"${stroke}${sw}${cap}/>`;
                default:
                    return '';
            }
        })
        .join('');
}
