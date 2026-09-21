# -*- coding: utf-8 -*-
"""chem.py — the chemistry kernel every data file is validated with.

If a formula does not parse, or an equation does not balance, the build fails.
That is the whole point: it separates a dataset from a guess.
"""
import re
from fractions import Fraction

# IUPAC/CIAAW abridged standard atomic weights. Every molar mass in this warehouse
# is *derived* from this table, never copied from somewhere that may have rounded.
ATOMIC_WEIGHT = {
 "H":1.008,"He":4.0026,"Li":6.94,"Be":9.0122,"B":10.81,"C":12.011,"N":14.007,
 "O":15.999,"F":18.998,"Ne":20.180,"Na":22.990,"Mg":24.305,"Al":26.982,"Si":28.085,
 "P":30.974,"S":32.06,"Cl":35.45,"Ar":39.948,"K":39.098,"Ca":40.078,"Sc":44.956,
 "Ti":47.867,"V":50.942,"Cr":51.996,"Mn":54.938,"Fe":55.845,"Co":58.933,"Ni":58.693,
 "Cu":63.546,"Zn":65.38,"Ga":69.723,"Ge":72.630,"As":74.922,"Se":78.971,"Br":79.904,
 "Kr":83.798,"Rb":85.468,"Sr":87.62,"Y":88.906,"Zr":91.224,"Nb":92.906,"Mo":95.95,
 "Tc":98.0,"Ru":101.07,"Rh":102.91,"Pd":106.42,"Ag":107.87,"Cd":112.41,"In":114.82,
 "Sn":118.71,"Sb":121.76,"Te":127.60,"I":126.90,"Xe":131.29,"Cs":132.91,"Ba":137.33,
 "La":138.91,"Ce":140.12,"Pr":140.91,"Nd":144.24,"Sm":150.36,"Eu":151.96,"Gd":157.25,
 "Tb":158.93,"Dy":162.50,"Ho":164.93,"Er":167.26,"Tm":168.93,"Yb":173.05,"Lu":174.97,
 "Hf":178.49,"Ta":180.95,"W":183.84,"Re":186.21,"Os":190.23,"Ir":192.22,"Pt":195.08,
 "Au":196.97,"Hg":200.59,"Tl":204.38,"Pb":207.2,"Bi":208.98,"Th":232.04,"U":238.03,
 "Pu":244.0,"C":12.011,
}
ATOMIC_WEIGHT["D"] = 2.0141  # deuterium, for heavy-water realism

# Extended to the whole table: the 33 symbols the abridged list above left out, so a
# formula containing any element parses.  A radionuclide with no standard atomic weight
# carries the mass number of its most stable isotope, which is what CIAAW brackets and
# what a lab calculation should use.  Generated once by scripts/vendor_mendeleev.py from
# raw/mendeleev/element_data.json (IUPAC/CIAAW via mendeleev, MIT) - sha256 b162c1f34ab0f1d3 - so the
# weights are derived from a cited table, never typed in.
ATOMIC_WEIGHT.update({
    "Pm": 144.913, "Po": 209, "At": 210, "Rn": 222, "Fr": 223,
    "Ra": 226, "Ac": 227, "Pa": 231.036, "Np": 237, "Am": 243,
    "Cm": 247, "Bk": 247, "Cf": 251, "Es": 252, "Fm": 257,
    "Md": 258, "No": 259, "Lr": 262, "Rf": 267, "Db": 268,
    "Sg": 271, "Bh": 274, "Hs": 269, "Mt": 276, "Ds": 281,
    "Rg": 281, "Cn": 285, "Nh": 286, "Fl": 289, "Mc": 288,
    "Lv": 293, "Ts": 294, "Og": 294,})

ELEMENTS = set(ATOMIC_WEIGHT) | {"D"}


_PLACEHOLDER_FORMULAS = {"mix", "mixture", "various", "x", "unknown", "n/a", ""}
_OPEN, _CLOSE = "([{", ")]}"


def _num(text):
    """'12', '', '1/2' -> float/None handling of stoichiometric subscripts."""
    if not text:
        return 1.0
    if "/" in text:
        a, b = text.split("/")
        return float(a) / float(b)
    return float(text)


def _parse_scope(s, i):
    """recursive-descent: returns (counts, index_of_closing_bracket_or_end)"""
    counts = {}
    while i < len(s):
        c = s[i]
        if c in _CLOSE:
            return counts, i
        if c in _OPEN:
            inner, j = _parse_scope(s, i + 1)
            if j >= len(s) or s[j] not in _CLOSE:
                raise ValueError(f"unclosed bracket in {s!r}")
            j += 1
            m = re.match(r"(\d+(?:/\d+)?)", s[j:])
            mult = _num(m.group(1)) if m else 1.0
            if m:
                j += m.end()
            for el, n in inner.items():
                counts[el] = counts.get(el, 0) + n * mult
            i = j
            continue
        m = re.match(r"([A-Z][a-z]?|D)(\d*(?:/\d+)?)", s[i:])
        if not m or not m.group(1):
            raise ValueError(f"cannot read {s[i:]!r} in formula {s!r}")
        el = m.group(1)
        if el not in ATOMIC_WEIGHT:
            raise ValueError(f"unknown element {el!r}")
        counts[el] = counts.get(el, 0) + _num(m.group(2))
        i += m.end()
    return counts, i


def count_atoms(body):
    """Atom counts for a formula fragment: 'Cu(OH)2', 'K4[Fe(CN)6]', 'Fe(CN)6'."""
    counts, j = _parse_scope(body, 0)
    if j < len(body) and body[j] in _CLOSE:
        j += 1
    if j != len(body):
        raise ValueError(f"trailing garbage {body[j:]!r} in {body!r}")
    if not counts:
        raise ValueError(f"no atoms found in {body!r}")
    return counts


def parse_formula(f):
    """Full formula -> element counts. Handles hydrates/adducts (dot), brackets,
    charge markers, and 'n' polymer repeats (ignored with a flag)."""
    if f is None or str(f).strip().lower() in _PLACEHOLDER_FORMULAS:
        raise ValueError(f"not a strict formula: {f!r}")
    s = str(f).strip().replace("\u00b7", ".").replace("\u2022", ".").replace("*", ".")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[a-z]\)?$", lambda m: m.group(), s)  # keep as-is
    s = re.sub(r"\)n$", ")", s)
    s = re.sub(r"\^\+?\d*", "", s)
    s = re.sub(r"\^-?\d*", "", s)
    total, polymer = {}, s.endswith("n") or "n" in re.findall(r"\dn\b", s)
    for part in s.split("."):
        if not part:
            continue
        m = re.match(r"^(\d+(?:/\d+)?)(.+)$", part)
        mult, body = (_num(m.group(1)), m.group(2)) if m else (1.0, part)
        for el, n in count_atoms(body).items():
            total[el] = total.get(el, 0) + mult * n
    if not total:
        raise ValueError(f"empty formula {f!r}")
    out = {k: (int(v) if abs(v - round(v)) < 1e-9 else v) for k, v in total.items()}
    return out


def molar_mass(formula_or_counts, dp=3):
    c = formula_or_counts if isinstance(formula_or_counts, dict) else parse_formula(formula_or_counts)
    return round(sum(ATOMIC_WEIGHT[e] * n for e, n in c.items()), dp)


def hill(c):
    """Hill formula. Note: carbon goes first, hydrogen second *only if present* -
    CCl4 is CCl4, not CHCl4."""
    keys = sorted(c)
    if "C" in c:
        keys = ["C"] + (["H"] if "H" in c else []) + [k for k in keys if k not in ("C", "H")]
    return "".join(k + (str(int(c[k])) if c[k] != 1 else "") for k in keys)


# ------------------------------------------------------------------ equation text
_TERM = re.compile(r"^\s*(?:(\d+(?:/\d+)?)\s+)?(.+?)\s*(?:\((s|l|g|aq|soln)\))?\s*$")


def _split_terms(side):
    """Split a side of an equation on ' + ' at bracket depth 0.
    Format rule the whole warehouse follows (and the validator enforces):
    terms are separated by ' + ' with spaces, so 'H+ + Cl-' and 'Fe(CN)6' both parse."""
    parts, buf, depth, i = [], "", 0, 0
    while i < len(side):
        c = side[i]
        if c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            depth -= 1
        if c == "+" and depth == 0 and side[i - 1] == " " and side[i + 1: i + 2] == " ":
            parts.append(buf.strip())
            buf = ""
            i += 2
            continue
        buf += c
        i += 1
    if buf.strip():
        parts.append(buf.strip())
    return [p for p in parts if p]


def parse_side(side):
    """'2 NaOH(aq) + CuSO4(aq)' -> [(2,'NaOH','aq'), (1,'CuSO4','aq')]"""
    terms = _split_terms(side)
    if not terms:
        raise ValueError(f"empty side {side!r}")
    items = []
    for t in terms:
        m = _TERM.match(t)
        if not m:
            raise ValueError(f"cannot parse term {t!r}")
        coeff, formula, phase = m.groups()
        items.append((_num(coeff) if coeff else 1, formula.strip(), phase))
    return items


def strip_charge(formula):
    """returns (bare_formula, charge) accepting 'Fe(3+)', 'Fe3+', 'SO4(2-)', 'e-'"""
    f = formula.strip()
    if f in ("e-", "e", "electron"):
        return "e", -1
    m = re.search(r"\((\d*)([+-])\)$", f)
    if m:
        return re.sub(r"\((\d*)([+-])\)$", "", f), (1 if m.group(2) == "+" else -1) * int(m.group(1) or 1)
    m = re.search(r"(\d*)([+-])$", f)
    if m and not re.search(r"\)$", f):
        bare = f[: m.start()]
        if re.search(r"[\]\)]$", bare) and m.group(1) == "":
            return f, 0
        if re.search(r"\d$", bare) and m.group(1) == "":
            return f, 0
        if m.group(1) and bare.endswith((")", "]")):
            # 'Ag(NH3)2+' - the 2 is a subscript on the group, the charge is +1
            return f[: m.start() + len(m.group(1))], (1 if m.group(2) == "+" else -1)
        return bare, (1 if m.group(2) == "+" else -1) * int(m.group(1) or 1)
    return f, 0


def composition(side):
    """element totals + charge for one side of an equation"""
    tot = {"charge": 0}
    for coeff, formula, _ph in parse_side(side):
        bare, q = strip_charge(formula)
        if bare == "e":
            tot["charge"] += coeff * q
            continue
        for el, n in parse_formula(bare).items():
            tot[el] = tot.get(el, 0) + coeff * n
        tot["charge"] += coeff * q
    return tot


_AMBIGUOUS_OK = False


def balance(reactants, products, allow_ambiguous=False):
    global _AMBIGUOUS_OK
    _AMBIGUOUS_OK = allow_ambiguous
    """Exact integer balancing of a molecular or ionic equation.
    Returns (r_coeffs, p_coeffs) and raises ValueError when it cannot be a real reaction."""
    r, p = parse_side(reactants), parse_side(products)
    # A "reaction" whose two sides hold the same species is not a reaction; without
    # this check the solver happily returns [1] -> [1] for e.g. 'H2 -> H2'.
    if sorted(f for _c, f, _ in r) == sorted(f for _c, f, _ in p):
        raise ValueError("trivial identity: both sides hold the same species")
    # sign convention: reactants positive, products negative, so A x = 0 means
    # "atoms in = atoms out" for the coefficient vector x.
    species = [(+1, f) for _c, f, _ in r] + [(-1, f) for _c, f, _ in p]
    comps, charges = [], []
    for sign, f in species:
        bare, q = strip_charge(f)
        comps.append({e: sign * n for e, n in ({} if bare == "e" else parse_formula(bare)).items()})
        charges.append(sign * (0 if bare == "e" else q) if bare != "e" else sign * q)
    els = sorted({e for c in comps for e in c})
    mat = [[c.get(e, 0) for c in comps] for e in els]
    if any(charges):
        mat.append(charges)
    vecs = _nullspace(mat, len(species))
    if not vecs:
        raise ValueError("no balancing solution (atoms/charge cannot be conserved)")
    if len(vecs) > 1 and not _AMBIGUOUS_OK:
        raise ValueError(f"ambiguous skeleton: {len(vecs)} independent balances exist - curation must pin it")
    best = None
    for v in vecs:
        den = 1
        for x in v:
            if x.denominator > 1:
                den = den * x.denominator // _gcd(den, x.denominator)
        ints = [int(x * den) for x in v]
        if any(x == 0 for x in ints):
            continue
        if min(ints) < 0:
            ints = [-x for x in ints]
        if min(ints[:len(r)]) < 1 or min(ints[len(r):]) < 1:
            continue
        g = 0
        for x in ints:
            g = _gcd(g, abs(x))
        ints = [x // (g or 1) for x in ints]
        if best is None or sum(ints) < sum(best):
            best = ints
    if best is None:
        raise ValueError("only a trivial/zero balance exists")
    return best[: len(r)], best[len(r):]


def check_equation(text):
    """'a A + b B -> c C + d D'  -> dict(ok, atoms_left, atoms_right, charge_left, charge_right)"""
    if "->" in text:
        lhs, rhs = text.split("->", 1)
    elif "\u2192" in text:
        lhs, rhs = text.split("\u2192", 1)
    elif "=" in text:
        lhs, rhs = text.split("=", 1)
    else:
        raise ValueError("no arrow in equation")
    cl, cr = composition(lhs), composition(rhs)
    problems = [f"{e}: {cl.get(e,0)} != {cr.get(e,0)}" for e in sorted(set(cl) | set(cr))
                if abs(cl.get(e, 0) - cr.get(e, 0)) > 1e-9]
    return {"ok": not problems, "problems": problems,
            "charge": (cl.get("charge", 0), cr.get("charge", 0)),
            "elements": {e: cl.get(e, 0) for e in sorted((set(cl) | set(cr)) - {"charge"})}}


def _gcd(a, b):
    a, b = abs(a), abs(b)
    while b:
        a, b = b, a % b
    return a


def _nullspace(mat, n):
    m = [[Fraction(x) for x in row] + [Fraction(0)] for row in mat]
    for row in m:
        while len(row) < n:
            row.append(Fraction(0))
    rows = len(m)
    piv, where = 0, [-1] * n
    for c in range(n):
        sel = next((r for r in range(piv, rows) if m[r][c] != 0), None)
        if sel is None:
            continue
        m[piv], m[sel] = m[sel], m[piv]
        pv = m[piv][c]
        m[piv] = [x / pv for x in m[piv]]
        for rr in range(rows):
            if rr != piv and m[rr][c] != 0:
                f = m[rr][c]
                m[rr] = [a - f * b for a, b in zip(m[rr], m[piv])]
        where[c] = piv
        piv += 1
        if piv == rows:
            break
    out = []
    for fc in [c for c in range(n) if where[c] == -1]:
        v = [Fraction(0)] * n
        v[fc] = Fraction(1)
        for c in range(n):
            if where[c] != -1:
                v[c] = -m[where[c]][fc]
        out.append(v)
    return out


def fmt(x, dp=2):
    if x is None:
        return "n/a"
    if isinstance(x, (int, float)) and abs(x) < 1e6 and float(x).is_integer() and dp and abs(x) >= 1:
        return str(int(x))
    return f"{x:.{dp}f}" if isinstance(x, (int, float)) else str(x)


SUBS = str.maketrans("0123456789", "₀₁₂₃₄₅₆₇₈₉")


def sub(s):
    return re.sub(r"(?<=[A-Za-z)\]])(\d+)", lambda m: m.group(1).translate(SUBS), s or "")


# ------------------------------------------------------- oxidation-state algebra
# The rules below are the textbook algorithm (NCERT class-XI ch.8 / CRC): F is -1
# in every compound; group 1 is +1 and group 2 is +2; O is -2 unless the species is
# a peroxide (-1) or superoxide (-1/2); H is +1 unless the other atoms are all metals
# (hydride, -1); the sum of the states equals the charge on the particle.  Anything
# the rules cannot pin down is reported as unresolved rather than guessed.
_FIXED = {"F": -1, "Li": 1, "Na": 1, "K": 1, "Rb": 1, "Cs": 1, "Fr": 1,
          "Be": 2, "Mg": 2, "Ca": 2, "Sr": 2, "Ba": 2, "Ra": 2,
          "Al": 3, "Ga": 3, "In": 3, "Tl": 1, "Zn": 2, "Cd": 2, "Ag": 1}
_METALS = set(_FIXED) | {"Fe", "Co", "Ni", "Cu", "Cr", "Mn", "Pb", "Sn", "Bi",
                         "Sb", "Sc", "Ti", "V", "Y", "Zr", "Nb", "Mo", "Hf", "Ta",
                         "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "La", "Ce", "Pr",
                         "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
                         "Lu", "U", "Th", "Pa", "Np", "Pu", "Am", "Cm"}
_LONE = re.compile(r"([A-Z][a-z]?)(\d*(?:/\d+)?)")
_GROUP = re.compile(r"([(\[{])([^\]\})]*)([)\]])(\d*(?:/\d+)?)")


def _tokens(part):
    """'(NH4)2SO4' -> [('group', 'NH4', 2.0), ('el', 'S', 1.0), ('el', 'O', 4.0)]

    Positions are the absolute indices the regex reports: `match(s, i).end()` is
    measured from the start of `s`, so the cursor is set to it, never advanced by it.
    """
    out, i = [], 0
    while i < len(part):
        m = _GROUP.match(part, i)
        if m:
            body = re.sub(r"[(\[\]){}]", "", m.group(2))
            out.append(("group", body, _num(m.group(4))))
            i = m.end()
            continue
        m = _LONE.match(part, i)
        if not m or not m.group(1):
            raise ValueError(f"cannot read {part[i:]!r}")
        out.append(("el", m.group(1), _num(m.group(2))))
        i = m.end()
    return out


def _clean(formula):
    t = str(formula).strip().replace("\u00b7", ".").replace("\u2022", ".").replace("*", ".")
    t = re.sub(r"\s+", "", t)
    return t


def _split_charge(t):
    """'SO4^2-' -> ('SO4', -2); 'Fe(CN)6^4-' -> ('Fe(CN)6', -4); also '^2+', '^-', '^+'."""
    m = re.search(r"\^\s*(\d*)([+-])$", t) or re.search(r"\^\s*([+-])(\d*)$", t)
    if not m:
        return t, 0
    if m.lastindex == 2 and m.re.pattern.endswith(r"([+-])$"):
        n, sign = m.group(1), m.group(2)
    else:
        sign, n = m.group(1), m.group(2)
    val = int(n) if n else 1
    return t[:m.start()], (-val if sign == "-" else val)


def _flat(text):
    """Atom counts of a whole particle, brackets and hydrate dots honoured."""
    tot = {}
    for part in [q for q in text.split(".") if q]:
        m = re.match(r"^(\d+(?:/\d+)?)(.+)$", part)
        mult, sub = (_num(m.group(1)), m.group(2)) if m else (1.0, part)
        try:
            inner = count_atoms(re.sub(r"\^\S+$", "", sub))
        except ValueError:
            return None
        for e, n in inner.items():
            tot[e] = tot.get(e, 0) + mult * n
    return tot or None


# elements that are genuinely metals: _METALS also holds the halogens and Be/Al via
# _FIXED, and calling fluorine a metal lets the chalcogen rule fire in SF6.
_TRUE_METALS = {_M for _M in _METALS if _M not in ("F", "Cl", "Br", "I", "H", "O",
                                                   "S", "Se", "Te", "At", "Po")}


def _guesses(counts, omode=0):
    """The states the rules fix for this atom set; anything left out is unknown.

    omode: 0 normal, 1 peroxide, 2 superoxide - the three conventions tried in order.
    """
    g = {e: _FIXED[e] for e in counts if e in _FIXED}
    if "O" in counts and "F" not in counts:
        g["O"] = (-2, -1, -0.5)[omode]
    rest = lambda e: [x for x in counts if x != e]
    if "H" in counts:
        g["H"] = -1 if all(o in _TRUE_METALS for o in rest("H")) else 1
    if "F" in counts:
        g["F"] = -1
    for e in ("Cl", "Br", "I"):
        # -1 as usual.  Left free (the balance then decides) exactly when nothing but
        # O, F or H is attached, which is what keeps Cl2O, HClO and KClO3 readable
        # while an oxychloride such as CrO2Cl2 still takes the halide value.
        if e in counts and "F" not in counts:
            oth = rest(e)
            if oth and not all(o in ("O", "F", "H") for o in oth):
                g[e] = -1
    for e in ("S", "Se", "Te"):                       # chalcogen against metals/H only
        if e in counts and all(o in _TRUE_METALS or o == "H" for o in rest(e)):
            g[e] = -2
    return {k: v for k, v in g.items() if k in counts}


def _close(counts, target, omode=0):
    """Solve one attempt.  Returns (states, notes) when the rules close, else None."""
    g = _guesses(counts, omode)
    unknown = [e for e in counts if e not in g]
    known = sum(counts[e] * g[e] for e in g)
    if len(unknown) == 1:
        u = unknown[0]
        val = (target - known) / counts[u]
        if abs(val - round(val)) < 1e-6:
            val = int(round(val))
        elif not (omode == 2 and u == "O"):
            return None                       # Fe3O4: no single state fits - mixed valence
        extra = [("peroxide: O taken as -1", "superoxide: O taken as -1/2")[omode - 1]] if omode else []
        return {**g, u: val}, extra
    if not unknown:
        if abs(known - target) < 1e-6:
            return (dict(g), ["all states fixed by rule, balance verified"])
        return None
    return None


def _close_multi(counts, target, inner_states, inner_notes, used):
    for omode in range(3):
        r = _close(counts, target, omode)
        if r:
            st, notes = r
            out = {}
            for k, v in st.items():
                out.setdefault(k, set()).add(v)
            for k, vv in inner_states.items():
                out.setdefault(k, set()).update(vv)
            return {k: sorted(v) for k, v in sorted(out.items())}, notes + inner_notes, used
    return None


def _group_candidates(counts, gc):
    """(group, times, remainder, fixed_charge) for known polyatomic ions, best first.

    Largest group, then the most copies, then the smallest remainder - so SO4 is
    preferred over S2O3 in CuSO4 rather than matching a subset that leaves rubbish.
    """
    out = []
    for g, q in gc.items():
        if g in counts:
            continue
        try:
            c = count_atoms(g)
        except ValueError:
            continue
        if sum(c.values()) < 2:
            continue
        if not all(counts.get(e, 0) >= n - 1e-9 for e, n in c.items()):
            continue
        times = min(int(counts[e] // n) for e, n in c.items())
        for k in range(max(times, 1), 0, -1):
            rem = dict(counts)
            for e, n in c.items():
                rem[e] = rem.get(e, 0) - n * k
                if abs(rem[e]) < 1e-9:
                    del rem[e]
            if not rem:
                continue
            if not any(abs(counts.get(e, 0) - n * k) < 1e-9 for e, n in c.items()):
                continue          # a nibble that leaves the group's elements behind is a misread
            out.append((k, -sum(c.values()) * k, g, k, rem, q * k, c))
    out.sort(key=lambda t: (t[0], t[1], t[2]))
    return [(t[2], t[3], t[4], t[5], t[6]) for t in out]


def ox_states(formula, group_charges=None, charge=0, _depth=0):
    """Assign oxidation states by the textbook algorithm.

    Returns (states, unresolved, notes): `states` maps symbol -> sorted list of
    numbers (a list because one formula can hold the same element in two
    environments - (NH4)(NO3) gives N at -3 and +5), `unresolved` lists the symbols
    the rules cannot pin down, which are deliberately left without a value.

    Passes, simplest first:  (a) the fixed rules alone;  (b) the same rules with
    polyatomic ions from `group_charges` consumed as charged units.  A flat formula
    such as NH4NO3 therefore yields the *average* state of N, which is what the
    written formula supports; the bracketed (NH4)(NO3) yields both environments.
    """
    s0, own = _split_charge(_clean(formula))
    if _depth == 0 and own:
        charge = charge or own
    gc = group_charges or {}
    counts = _flat(s0)
    if not counts:
        return {}, [], [f"formula {formula!r} does not parse"]
    target = charge or 0
    if len(counts) == 1:                       # an element, or a monoatomic ion
        el = next(iter(counts))
        return {el: [int(target) if target else 0]}, [], (["element in its standard state: 0"]
                                                          if not target else ["monoatomic ion"])
    written = set(re.findall(r"\(([^()]+)\)", s0)) | set(re.findall(r"\[([^\[\]]+)\]", s0))
    honour = bool(written & set(gc))          # (NH4)(NO3) says two ions; NH4NO3 does not
    if not honour:
        r = _close_multi(counts, target, {}, [], [])
        if r:
            st, notes, _u = r
            return st, [], notes
    for _g, _k, rem, fixed, _cc in _group_candidates(counts, gc):
        inner_states, inner_notes = {}, []
        ok = True
        for kk in range(_k):
            sub, un, nt = ox_states(_g, gc, (fixed // _k) if _k else fixed, _depth + 1)
            if un:
                ok = False
                break
            for k2, v2 in sub.items():
                inner_states.setdefault(k2, set()).update(v2)
            inner_notes += nt
        if not ok:
            continue
        r = _close_multi(rem, target - fixed, inner_states, inner_notes, [_g])
        if r:
            st, notes, _used = r
            notes = [f"polyatomic group {_g} (charge {fixed // _k:+d}) consumed {_k}\u00d7"] + notes
            unresolved = sorted(set(counts) - set(st))
            return st, unresolved, notes
    if r:
        st, notes, _u = r
        return st, sorted(set(counts) - set(st)), notes
    if honour:
        r = _close_multi(counts, target, {}, [], [])
        if r:
            st, notes, _u = r
            return st, [], notes + ["bracketed groups did not resolve, so the average state is given"]
    g = _guesses(counts, 0)
    return ({k: [v] for k, v in g.items()},
            sorted(set(counts) - set(g)),
            ["rules leave more than one element free, so no state is asserted"])




def criss_cross(pos, neg):
    """Predict the formula of a binary compound from two oxidation states.

    Fe(III) with O(II) -> 'Fe2O3': the magnitudes are exchanged and reduced by
    their gcd.  Pure arithmetic, so the app can do the same thing for any pair.
    """
    (a, za), (b, zb) = pos, neg
    za, zb = abs(int(za)), abs(int(zb))
    if not za or not zb:
        return None
    g = _gcd(za, zb) or 1
    na, nb = zb // g, za // g
    return a + (str(na) if na > 1 else "") + b + (str(nb) if nb > 1 else "")


def pauling_ionicity(dchi):
    """Pauling's percent ionic character, 100*(1 - exp(-(dX/2)^2))."""
    import math
    return round(100 * (1 - math.exp(-((dchi or 0.0) / 2.0) ** 2)), 1)
