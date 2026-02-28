# Icon map

Normalized mapping for icon-related setting values used in the Aexis Dawn-based theme.

## Naming strategy

- **Snippet-backed glyph icons** should follow `icon-{name}` for direct SVG snippets and assets.
- **Accordion icon settings** should use Dawn's canonical snake_case values and route through `icon-accordion`.
- **Material-symbol setting values** (free text like `local_shipping`, `check_circle`) should route through `material-icon`.
- Prefer **`icon-checkmark`** over `icon-tick` in new custom work to avoid duplicate semantics.

## Mapping

| icon setting value | snippet name | status |
|---|---|---|
| `apple`, `banana`, `bottle`, `box`, `carrot`, `chat_bubble`, `check_mark`, `clipboard`, `dairy`, `dairy_free`, `dryer`, `eye`, `fire`, `gluten_free`, `heart`, `iron`, `leaf`, `leather`, `lightning_bolt`, `lipstick`, `lock`, `map_pin`, `nut_free`, `pants`, `paw_print`, `pepper`, `perfume`, `plane`, `plant`, `price_tag`, `question_mark`, `recycle`, `return`, `ruler`, `serving_dish`, `shirt`, `shoe`, `silhouette`, `snowflake`, `star`, `stopwatch`, `truck`, `washing` | `icon-accordion` | existing |
| `none` | `icon-accordion` (no output branch) | existing |
| `icon` / `icon_1` / `icon_2` / `icon_3` / `icon_4` text values for custom content blocks (material-symbol names) | `material-icon` | added |
| `add_circle`, `check_circle`, `add`, `check` (upsell toggle styles) | `material-icon` | added |
| `checkbox_1` upsell style | `checkbox-icons` | added |
| `tick` | `icon-tick` | deprecated |
| `checkmark` | `icon-checkmark` | existing |
| Any new `icon-*` render target not present under `snippets/icon-*.liquid` or `assets/icon-*.svg` | N/A | missing |

## Notes

- `icon-checkmark` and `icon-tick` are semantically overlapping check glyphs; use `icon-checkmark` for consistency.
- `icon-with-text` and `icon-with-content-block` are composite/layout snippets and not direct icon glyph snippets.
