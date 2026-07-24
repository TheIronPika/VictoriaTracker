# FIXES.md — VictoriaTracker

Log of issues found by overnight review and subsequently fixed.
Add a new entry each time you resolve a finding. The nightly reviewer reads this file and will not re-flag resolved items.

## Format

```
### YYYY-MM-DD — <short title>
**Finding:** <what the reviewer flagged and where>
**Fix:** <what was changed and why>
```

---

<!-- Add entries below this line -->

### 2026-07-07 — doRedeem ignored spendStars result (free token bug)
**Finding:** Overnight review 2026-06-29, H1. `web/ui/shop-ui.js` `doRedeem` awaited `spendStars(...)` but never checked its return value, so if the star balance dropped between opening the confirm sheet and confirming (e.g. another device redeemed/awarded in between), the spend silently no-op'd while the excuse/streak-reset/mark-off token was still granted for free.
**Fix:** `doRedeem` now captures `const ok = await spendStars(...)` and returns early (closing the confirm sheet, re-rendering the shop) without granting any token when `ok` is false.
