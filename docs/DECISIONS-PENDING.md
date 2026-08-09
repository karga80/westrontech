# Emir'i bekleyen kararlar

Bir ajan, kendi yetkisinde olmayan bir kararla karşılaştığında buraya yazar ve
işin geri kalanına devam eder. Tahmin edip ilerlemek yasaktır.

Format: ne soruluyor, neden ajan karar veremiyor, seçenekler ve her birinin bedeli,
ajanın önerisi, ve karar verilene kadar ne bloke.

---

## D1 — Kural süresi dolmadan uyarı ne zaman ve nasıl gösterilmeli?

**Bağlam:** T4 kapsamında kural TTL üst sınırı 168 → 720 saate çıkıyor. Emir bu
artışı **bildirim koşuluyla** onayladı: kalan süre listede görünecek ve süre
dolmadan uyarı çıkacak. Uyarının zamanlaması ve biçimi kararlaştırılmadı.

**Neden ajan veremez:** Bu bir risk iştahı sorusu. Çok erken uyarı gürültü yapar ve
kullanıcı uyarıları görmezden gelmeye başlar; çok geç uyarı korumayı işlevsiz kılar.
Dengeyi ürünün sahibi seçer.

**Seçenekler:**
- Kalan sürenin %10'unda — süreye orantılı, ama 1 saatlik kuralda 6 dakika kalır.
- Son 24 saatte — uzun kurallar için anlamlı, 1-6 saatlik kurallarda hiç çıkmaz.
- İkisinin büyüğü — her iki uçta da makul, uygulaması biraz daha karmaşık.

**Biçim:** yalnızca liste rozeti mi, yoksa uygulama içi bildirim de mi?

**Orion önerisi:** ikisinin büyüğü + liste rozeti. Bildirim yalnızca kural
gerçekten süresi dolduğu için devre dışı kaldığında çıksın — o an kullanıcının
bilmesi gereken bir şey oldu demektir.

**Bloke ettiği:** T4'ün uyarı kısmı. Zamanlama ve dropdown'lar bundan bağımsız
ilerleyebilir.
