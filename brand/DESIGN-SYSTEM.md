# Westron — Design System Handoff

Product: crypto wallet & payroll management, shipping as a **Tauri desktop app for macOS**.
Source of truth: `Westron Branding v2.dc.html` (open in a browser to see every spec rendered).

Files in this folder:
- `tokens.css` — CSS custom properties, drop straight into the app
- `tokens.json` — same values for JS/TS or a Rust-side config
- `README.md` — this document

---

## 0. Non-negotiables

1. Dark theme is fixed. The app stays dark even when macOS is light (`theme: "Dark"`).
2. **Purple (#7C5CFF) never carries data.** It is the brand and the primary CTA only.
3. **Green/red only carry direction** (buy/sell, up/down, gain/loss). Never decorative.
4. Direction is never colour alone — every figure is preceded by `+`/`−` or an arrow.
5. All figures use JetBrains Mono + `font-variant-numeric: tabular-nums`, right-aligned in tables.
6. No card shadows. Separation is done with 1px borders and hairlines.

---

## 1. Colour

### Brand layer
| Token | Hex | Use |
|---|---|---|
| bg | #0B0C14 | App background |
| surface | #14161F | Cards, title bar |
| accentBg | #241C4D | Accent surfaces, hero |
| accent | #7C5CFF | Primary CTA, brand, logo |
| accentLight | #C9B8FF | Links, inline emphasis |
| accentDark | #5B3DF0 | Logo on light surfaces |
| text | #F2F2F7 | Primary text |
| text2 | #9298B8 | Secondary text |
| text3 | #6E7590 | Labels, cents, muted figures |

Gradient (logo only): #7C5CFF → #C9B8FF, left to right.

### Financial set (tables, lists, buy/sell)
| Role | Fill | Hover | Tint | Text on dark | Text on fill |
|---|---|---|---|---|---|
| Buy / Long | #00D68F | #00B87A | rgba(0,214,143,.14) | #4FE9B4 | #06251B |
| Sell / Short | #FF4D5E | #E63950 | rgba(255,77,94,.14) | #FF8A96 | #2B070C |
| Pending / warning | #FFB020 | — | rgba(255,176,32,.14) | #FFB020 | #2E1C00 |
| Info / transfer | #5B7CFA | — | rgba(91,124,250,.16) | #90A6FF | #061033 |

#00D68F and #FF4D5E are **never** used as body text — use the light tints on dark surfaces.

### Table surfaces
Row #10121B · zebra #161925 · hover/selected #1D2130 · header text #6E7590 · row border rgba(242,242,247,.08).

### Series colours
`#7C5CFF · #2FC4D6 · #F6C445 · #FF8A5B · #4FE9B4 · #A78BFA` — list dots, chain dots, donut and sparkline series. Identity, never direction.

### NFT rarity — fixed ladder
Legendary #F6C445 · Epic #7C5CFF · Rare #2FC4D6 · Common #9298B8 (neutral).
One colour per tier, always the same one. Rarity never borrows the buy/sell green-red. Listing/custody status (Listed, Cold, Escrow) is a **separate** badge, not part of this ladder.

---

## 2. Type

- **Space Grotesk** 500–700 — headings, balances, big numbers. Tracking −0.02em.
- **Inter** 400–600 — UI and body text. Desktop body size is **13px**, not the 15–16px used on the web.
- **JetBrains Mono** 400–500 — every figure, address, hash, code.

Numbers: `$142,834` at full weight, `.92` cents dimmed to #6E7590.
Addresses: always first 6 + last 4 — `0x7a3f…9c21` — click to copy, confirmation in #4FE9B4.

---

## 3. Desktop shell (Tauri · macOS)

- Window 1280×800 default, min 1040×680.
- Title bar 44px, `titleBarStyle: "Overlay"` — system traffic lights, 14px from the left. Put `data-tauri-drag-region` on the bar, never on buttons.
- Sidebar fixed 208px; body flexes. Network badge + truncated address always top right.
- Base unit 4px · table row 44px (compact 36px) · sidebar item 34px · button 32px · card radius 12px · control radius 8px.
- Native menu bar: Westron · Wallet · Transaction · View · Window · Help.
- Shortcuts: ⌘K command palette · ⌘N new transfer · ⌘⇧P run payroll · ⌘L lock wallet · ⌘R refresh · ⌘, settings.
- Chain calls live on the Rust side; the UI renders `invoke` results and shows skeleton rows for any call over 200ms.
- External links open in the system browser.

---

## 4. Transaction states

| State | Colour | Label |
|---|---|---|
| Awaiting signature | #FFB020 | "Awaiting signature · 1/3 signed" |
| Broadcast to chain | #5B7CFA | "Broadcast to chain · 0x9f2c…44ab" |
| Confirmed | #00D68F | "Confirmed · 12 blocks" |
| Failed | #FF4D5E | "Failed — out of gas" + Retry |

Every state is also spelled out in words, never colour alone.

## 5. Security patterns

- Destructive or irreversible actions get a **red primary button + an explicit confirmation step**. The purple CTA is never used to approve a signature.
- Seed phrases, private keys and full addresses are never left on screen; revealing them always follows a deliberate action.
- Lock screen after 5 minutes idle. Balances may blur on window blur (Settings → Privacy).

---

## 6. Components

### KPI strip
One card, max 4 cells, hairline dividers. Order is always **money → change → scope → inventory**.
Label 11px uppercase #6E7590 · value Space Grotesk 32/700 · support line 12px, `white-space: nowrap`.
Only the PNL cell is coloured; totals and counts stay neutral white.
No blanks: show a real number, a skeleton bar, or don't render the cell. Counts must reconcile across the screen.

### Wallet card
`repeat(auto-fill, minmax(300px, 1fr))`, 12px gap. Past six wallets, switch to the table layout.
1. Name (14/600) + chain badge right; custody type (Cold / Multisig / Watch) as a second badge next to the name.
2. Address, mono 11.5px #6E7590, click to copy.
3. Balance, Space Grotesk 26/700, cents dimmed.
4. Change: arrow + amount + percentage, one line, direction colour.
5. Breakdown: **two** cells — NFT floor PNL and token PNL; the count folds into the label ("12 NFTs · floor").
6. Actions: an Edit text link + a `···` menu. **Delete lives in the menu and asks for typed confirmation — never on the card face.**

Chain badge: one neutral pill with a chain-coloured dot. Colour is identity, not direction.
Hover: border rgba(242,242,247,.2), surface #161925. The whole card opens wallet detail; inner actions swallow the click.

### Portfolio table
Columns: Asset · Balance · 24h · Status. Row 44px, hover #1D2130, numeric columns mono/right-aligned.
Status pills use the financial tints (Settled / Pending / Transfer).

### NFT collection table
Columns: # · Collection · Floor price · 24h volume. Artwork 28px at 7px radius, row height 50px.
Verified collections get a ✓ in #4FE9B4. Flat change stays neutral #6E7590.

### NFT asset grid
Full-bleed square artwork, text block below (name 12/600, price mono 11px #9298B8). Listing state as an overlay pill top-left. Rarity badge from the fixed ladder above.

---

## 7. Logo

Single-stroke "w" with a dot at the tip. Lockups: horizontal (default), stacked, symbol only, wordmark only, mono.
Clear space ≥ ½ symbol height on every side. Minimum: lockup 96px wide, symbol 20px.
At ≤32px drop the dot, thicken the stroke, use solid #7C5CFF.
Never skew, rotate, recolour off-palette, change stroke weight, or set the wordmark in uppercase.
