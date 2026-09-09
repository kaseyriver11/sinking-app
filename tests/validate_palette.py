"""Python port of dataviz/scripts/validate_palette.js (no node available).
Faithful to the JS: same thresholds, same Machado 2009 matrices, same OKLab math."""
import sys, math, itertools, json

BAND = {"light": (0.43, 0.77), "dark": (0.48, 0.67)}
CHROMA_FLOOR = 0.10
CVD_TARGET, CVD_FLOOR = 8.0, 6.0
NORMAL_FLOOR = 15.0
CONTRAST_MIN = 3.0
DEFAULT_SURFACE = {"light": "#fcfcfb", "dark": "#1a1a19"}

MACHADO = {
    "protan": [[0.152286, 1.052583, -0.204868],
               [0.114503, 0.786281, 0.099216],
               [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968],
               [0.280085, 0.672501, 0.047413],
               [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779],
               [-0.078411, 0.930809, 0.147602],
               [0.004733, 0.691367, 0.303900]],
}

def hex2srgb(h):
    h = h.strip().lstrip("#")
    return [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]

def s2lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lin(h):
    return [s2lin(c) for c in hex2srgb(h)]

def rel_lum(h):
    r, g, b = lin(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a, b):
    hi, lo = sorted([rel_lum(a), rel_lum(b)], reverse=True)
    return (hi + 0.05) / (lo + 0.05)

def oklab_from_lin(rgb):
    r, g, b = rgb
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1/3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1/3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1/3)
    return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s]

def oklab(h):
    return oklab_from_lin(lin(h))

def oklch(h):
    L, a, b = oklab(h)
    return L, math.hypot(a, b)

def simulate(h, kind):
    r, g, b = lin(h)
    M = MACHADO[kind]
    return [min(1, max(0, M[i][0]*r + M[i][1]*g + M[i][2]*b)) for i in range(3)]

def delta_e(h1, h2, kind=None):
    a = oklab_from_lin(simulate(h1, kind) if kind else lin(h1))
    b = oklab_from_lin(simulate(h2, kind) if kind else lin(h2))
    return 100 * math.dist(a, b)

def validate(palette, mode="light", surface=None, pairs="adjacent"):
    surface = surface or DEFAULT_SURFACE[mode]
    lo, hi = BAND[mode]
    report, ok = [], True

    offband = [(c, round(oklch(c)[0], 3)) for c in palette if not (lo <= oklch(c)[0] <= hi)]
    if offband: ok = False
    report.append(("Lightness band", not offband,
                   f"outside band: {offband}" if offband else f"all {len(palette)} inside L {lo}-{hi}"))

    lowc = [(c, round(oklch(c)[1], 3)) for c in palette if oklch(c)[1] < CHROMA_FLOOR]
    if lowc: ok = False
    report.append(("Chroma floor", not lowc,
                   f"below floor (reads gray): {lowc}" if lowc else f"all {len(palette)} >= {CHROMA_FLOOR}"))

    n = len(palette)
    pairlist = list(itertools.combinations(range(n), 2)) if pairs == "all" else [(i, i+1) for i in range(n-1)]
    label = "all-pairs" if pairs == "all" else "adjacent"

    worst = None
    for kind in ("protan", "deutan"):
        for i, j in pairlist:
            d = delta_e(palette[i], palette[j], kind)
            if worst is None or d < worst[0]:
                worst = (d, kind, palette[i], palette[j])
    tri = min((delta_e(palette[i], palette[j], "tritan") for i, j in pairlist), default=99)
    wd = worst[0] if worst else 99
    cvd_state = "pass" if wd >= CVD_TARGET else ("floor" if wd >= CVD_FLOOR else "fail")
    if cvd_state == "fail": ok = False
    report.append(("CVD separation", cvd_state,
                   f"worst {label} {worst[3]}<->{worst[2]} dE {wd:.1f} ({worst[1]}) - tritan {tri:.1f}" if worst else "n/a"))

    nworst = None
    for i, j in pairlist:
        d = delta_e(palette[i], palette[j])
        if nworst is None or d < nworst[0]:
            nworst = (d, palette[i], palette[j])
    nd = nworst[0] if nworst else 99
    nor_state = "pass" if nd >= NORMAL_FLOOR else "fail"
    if nor_state == "fail": ok = False
    report.append(("Normal-vision floor", nor_state,
                   f"worst {label} {nworst[2]}<->{nworst[1]} dE {nd:.1f} (normal)" if nworst else "n/a"))

    low = [(c, round(contrast(c, surface), 2)) for c in palette if contrast(c, surface) < CONTRAST_MIN]
    report.append(("Contrast vs surface", "relief" if low else "pass",
                   f"below {CONTRAST_MIN}:1 - relief required (visible labels or table view): {low}"
                   if low else f"all {len(palette)} >= {CONTRAST_MIN}:1"))
    return report, ok

GLYPH = {True: "PASS", False: "FAIL", "pass": "PASS", "floor": "WARN", "fail": "FAIL", "relief": "WARN"}

if __name__ == "__main__":
    args = sys.argv[1:]
    palette = [c.strip() for c in args[0].split(",") if c.strip()]
    opts = {}
    i = 1
    while i < len(args):
        opts[args[i].lstrip("-")] = args[i+1]; i += 2
    mode = opts.get("mode", "light")
    surface = opts.get("surface") or DEFAULT_SURFACE[mode]
    pairs = opts.get("pairs", "adjacent")
    report, ok = validate(palette, mode, surface, pairs)
    print(f"\nPalette ({mode}, surface {surface}, categorical): {len(palette)} slots")
    for name, state, detail in report:
        print(f"  [{GLYPH.get(state, state):<4}] {name:<22} {detail}")
    print(f"\n  -> {'ALL CHECKS PASS' if ok else 'FAILED - fix the marked checks'}\n")
    # also print per-color contrast for reference
    for c in palette:
        print(f"     {c} contrast vs {surface}: {contrast(c, surface):.2f}:1")
    sys.exit(0 if ok else 1)
