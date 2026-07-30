# _deferred — Sonraki fazlara bırakılan modüller

Bu klasördeki kod Phase 1/v1 kapsamından **bilinçli olarak çıkarılmıştır**.
Silinmedi; ileride geri alınabilsin diye burada duruyor. Aktif uygulama
(`src/`, `src-tauri/`) bu klasöre hiçbir yerden referans vermez.

| Modül | Neden ertelendi | Geri almak için |
|-------|-----------------|-----------------|
| `trends-pipeline/` | X/TikTok trend takibi ayrı bir üründür; ayrı sunucu + 4 ücretli API gerektirir. Wallet-management çekirdeğinin dışında. | `apps/` altına geri taşı, kendi README'sindeki setup'ı izle. |
| `app/omni/` | Birleşik "omni" ekranı v1 kapsamı netleşene kadar bekliyor. | `src/app/omni/` altına geri taşı. |
| `app/tasks/` | Otomasyon görev merkezi Phase 2/3'e ait (sniping/otomasyon ile gelir). | `src/app/tasks/` altına geri taşı, Navbar'a link ekle. |
| `lib/swap.ts`, `lib/uniswap.ts` | Uniswap swap wallet-management çekirdeği değil; Uniswap'ın resmî olmayan quote API'sine bağımlı (kırılgan). | `src/lib/` altına geri taşı, WalletDetailClient'a SwapModal'ı geri bağla. |

Karar tarihi: 2026-07-30 · Emir onayı ile.
