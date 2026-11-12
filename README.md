# Pişti

Tarayıcıda çalışan, 2 veya 4 kişilik Pişti oyunu. Kendi yapay zekâsı vardır; kurulum, sunucu ya da internet bağlantısı gerektirmez (yalnızca yazı tipleri Google Fonts'tan gelir, gelmezse sistem yazı tipi kullanılır).

## Oynamak

`index.html` dosyasını tarayıcıda açman yeterli. İstersen yerel sunucuyla da açabilirsin:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Özellikler

- **2 kişi** ya da **4 kişi** (eşli 2'ye 2 veya herkes kendine)
- Her koltuk **İnsan** veya **Yapay zekâ** (Kolay / Orta / Zor) olabilir
  - Birden çok insan seçilirse aynı cihazda sırayla oynanır; sıra gelene kadar kartlar perdeyle gizlenir
  - Bütün koltukları yapay zekâya verip izleyebilirsin
- 51 / 101 / 151 puanlık maçlar, el sonu ayrıntılı puan tablosu
- Pişti (10) ve Vale piştisi (20), son alana kalan kartlar, en çok kart primi (3)
- Alabileceğin kartları vurgulayan ipucu, hamle geçmişi, kurallar
- Oyun tarayıcıya otomatik kaydedilir; sayfayı yenilesen de kaldığın yerden devam edersin
- Klavye: sıran geldiğinde `1`–`4` tuşlarıyla kart oynayabilirsin

## Yapay zekâ

Hiçbir seviye başka oyuncuların kartlarına bakmaz; yalnızca kendi elini, yerdeki açık kartları ve oynanmış kartları bilir.

| Seviye | Nasıl oynar |
| --- | --- |
| Kolay | Eşleşme görürse alır, sık sık rastgele oynar. |
| Orta | Çıkan kartları sayar. Her kart için sıradaki rakibin elinde eşini veya Vale'yi tutma olasılığını (hipergeometrik) hesaplar; pişti verme riskini, yerdeki puanı, Vale'yi saklamanın değerini tartar. |
| Zor | Görmediği kartları (rakip elleri, deste, yerdeki kapalı kartlar) yüzlerce kez rastgele dağıtır, her aday kart için eli sonuna kadar oynatır (Monte Carlo) ve ortalamada en çok puan getiren kartı seçer. |

Kendi aralarında oynatıldığında (eşleştirilmiş destelerle) el başına ortalama: Zor, Kolay'a karşı ~+7 puan; Orta, Kolay'a karşı ~+5 puan; Zor, Orta'ya karşı ~+0,5 puan. Pişti şans payı yüksek bir oyun olduğu için iyi oynayan iki oyuncu arasındaki fark doğal olarak küçüktür.

## Dosyalar

| Dosya | İçerik |
| --- | --- |
| `index.html` | Sayfa iskeleti |
| `css/style.css` | Masa ve kart tasarımı |
| `js/engine.js` | Kurallar (DOM'dan bağımsız, Node'da da çalışır) |
| `js/ai.js` | Yapay zekâ |
| `js/ui.js` | Arayüz, animasyonlar, oyun döngüsü, kayıt |
| `tests/simulate.js` | Kural testleri ve yapay zekâ turnuvası |

## Test

```bash
node tests/simulate.js        # 60 el
node tests/simulate.js 300    # daha fazla el
```

Test; pişti/Vale piştisi kurallarını, her elin sonunda 52 kartın tamamının dağıtıldığını, kart puanlarının toplamının 13 olduğunu ve yapay zekânın gizli kartları görmediğini (örneklenen dünyaların tutarlılığını) denetler.

## Kurallar (özet)

- Yere 4 kart açılır (3'ü kapalı), herkese 4'er kart dağıtılır.
- Yerdeki en üst kartla aynı sayıyı atan ya da Vale atan, yerdeki bütün kartları alır.
- Yerde tek kart varken aynı sayıyla almak **pişti**dir (10 puan); tek Vale'yi Vale ile almak 20 puandır. Tek kartı Vale ile almak pişti sayılmaz.
- Deste bitince yerde kalanlar son alan oyuncuya gider.
- Puanlar: her As 1, her Vale 1, Sinek 2 = 2, Karo 10 = 3, en çok kart = 3.
