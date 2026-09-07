# Vault — Restoration Estimating Notes

An Obsidian-friendly vault of **situation-based estimating / justification
notes** for insurance **restoration** scopes. Plain Markdown — drop the folder
into any Obsidian vault (or open this folder as a vault) and it works as-is.

## Hierarchy

```
Restoration Notes (MOC)      ← master index (start here)
└─ Flooring (MOC)            ← category
   └─ Underlayment (MOC)     ← topic
      ├─ Concrete Slab/…     ← situation notes
      └─ Wood Subfloor/…
```

Category → Topic → Situation. **Each leaf note = one concrete situation** and
its scope / justification language.

## Files
- `Restoration Notes (MOC).md` — master MOC (**start here**)
- `Flooring/Flooring (MOC).md` — Flooring category index
- `Flooring/Underlayment/Underlayment (MOC).md` — Underlayment topic index + matrix
- `Templates/Situation Note.md` — copy this to add a new situation

## Conventions
- **One note = one situation** so notes stay atomic and easy to expand.
- Frontmatter carries structured fields (`category`, `restoration_category`,
  `topic`, plus topic dimensions like `substrate` / `flooring` / `install`) and
  nested tags for querying (Dataview-ready).
- Body sections are consistent: **Requirement → Why it's required →
  Estimating note → Standards / references → Related**.

## Expanding
- **New situation** → copy `Templates/Situation Note.md`, fill frontmatter +
  body, link it into the relevant topic MOC.
- **New topic** (e.g. Flooring → Tear-Out) → add a topic MOC + folder, list it
  in the category MOC.
- **New category** (e.g. Water Mitigation, Drywall & Insulation) → add a
  category MOC + folder, list it in `Restoration Notes (MOC).md`.
