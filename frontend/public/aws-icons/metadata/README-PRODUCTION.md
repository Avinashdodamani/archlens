# ArchLens Production AWS Icon Package

This package contains named SVG assets extracted from the supplied AWS Architecture Icon PPT decks.

## Runtime roots
- `light/services`, `dark/services`: service/architecture icons
- `light/resources/<category>`, `dark/resources/<category>`: resource icons
- `light/categories`, `dark/categories`: category icons
- `light/groups`, `dark/groups`: group/boundary reference icons

## Selection
Do not infer filenames. Lookup `metadata/asset-catalog.json` by `icon_id` or mapped logical ID, then select the requested theme.

## Boundary and connection rules
Use `metadata/boundary-rules.json` and `metadata/relationship-rules.json`.

Generated from the two PPTX files supplied for this task.
