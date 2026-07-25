---
name: poster-card-uniform-size
description: Poster-grid cards must be exactly uniform size (reserved 2-line title height + scaled padding); regular face over condensed
metadata:
  type: feedback
---

Uniform card size within a poster grid is a **hard** requirement — not approximate. Achieve it with a fixed reserved title height (2-line clamp, `height`/`min-height` = `2.4 × title-size`) and by adjusting **padding**, never by letting card height vary with content; the poster stays a constant size across every card. Prefer the **regular display face over a condensed one even at small/dense sizes** — readability beats cramming more letters per line, and two-line wrapping handles long titles instead. The title and its year/aside share one vertical middle via flex `items-center` on the row (reliable where `-webkit-box-pack` is not).

**Why:** the user rejected an earlier take that let 2-line-title cards grow taller than 1-line ones, and that switched to a condensed face (Archivo Narrow) at high density — cards must be identical size, and the narrow face read worse when small.

**How to apply:** the per-density type scale is a lookup table keyed on `[data-cols="N"] .wn-grid` in `web/src/app/globals.css` (`--wn-ct-title-size` / `-meta-size` / `-sub-size` / `-aside-size` / `-over-size` / `-pad-x` / `-pad-y`, base = 5-column values); card-text elements consume the `.wn-ct-*` classes (`.wn-ct-titlerow` reserves the height). Tune sizes/padding there and keep the title height reserved so cards can't change size. See [[project-whats-next-build]].
