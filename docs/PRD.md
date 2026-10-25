# my-trainer — Ürün İsterleri (PRD) ve Geliştirme Planı

## Context

Kullanıcı, kendisinin ve arkadaşlarının kullanacağı bir "antrenör / yaşam takip" uygulaması istiyor. Klasör (`C:\Users\PC\source\claude\my-trainer`) boş; sıfırdan başlıyoruz. Sabit kısıtlar:

1. **Tamamen ücretsiz platformlarda** barındırılacak ve yayınlanacak.
2. **Çok kullanıcılı, Google ile giriş** (2026-10-25 revizyonu; önceki "tek kullanıcı" kısıtı kaldırıldı). Her kullanıcı **yalnızca kendi verisini** görür; başkalarına görünen tek şey liderlik tablosundaki herkese açık profil alanlarıdır. Ürün sahibi (ilk kullanıcı) **yönetici**dir ve erişim modunu `open` (Google ile giren herkes) / `invite` (beyaz liste) arasında değiştirebilir, kullanıcı engelleyebilir.
3. **Zorunlu onboarding**: Google bağlantısından hemen sonra profil formu (kullanıcı adı, görünen ad, **zorunlu profil fotoğrafı**, opsiyonel boy/doğum yılı/hedef). Tamamlanmadan uygulamaya girilemez.
4. **Oyunlaştırma**: Disiplin kazandırmak için puan sistemi + haftalık/aylık/tüm zamanlar liderlik tablosu (puanlama kuralları ürün sahibi tarafından belirlendi, bkz. §1.4).
5. **Telefon ana cihaz** (iPhone 16, spor salonunda hızlı giriş), masaüstü ikincil (analiz/grafik).

Soru-cevap turlarında netleşen isterler:

| Konu | Karar |
|---|---|
| Alan | Fitness + alışkanlık (karışık) |
| Antrenman tipi | Karışık: ağırlık antrenmanı omurga, kardiyo ayrı kayıt |
| Ek metrikler | Vücut ağırlığı + ölçüler, kalori/makro, uyku + su, özel alışkanlıklar |
| To-do | Aktif to-do modülü: tek seferlik ve tekrarlı görevler |
| Veri | Ücretsiz bulut DB, cihazlar arası senkron |
| Giriş | Google ile giriş; erişim modu `open` (varsayılan) veya `invite` (beyaz liste), yönetici ayarı |
| Kullanıcılar | Çok kullanıcılı; veri izolasyonu RLS ile `user_id = auth.uid()`; yalnızca profilin herkese açık alanları paylaşılır |
| Onboarding | Zorunlu: kullanıcı adı + görünen ad + **profil fotoğrafı (zorunlu)** |
| Oyunlaştırma | Puan motoru (DB trigger'ları), seviye, günlük/haftalık tavan, liderlik tablosu (hafta/ay/tümü), isteğe bağlı gizlilik |
| AI koç | **Var**: Google Gemini ücretsiz katmanı birincil, OpenRouter ücretsiz modelleri yedek; kota bitince kural tabanlı önerilere düşer |
| Gelişim fotoğrafı | Periyodik fotoğraf, **uçtan uca şifreli** (anahtar sunucuya gitmez) |
| Dil | TR/EN, ayarlardan değiştirilebilir |
| Cihazlar | **iPhone 16 birincil tasarım hedefi** (393×852 pt, Dynamic Island güvenli alanı), masaüstü ikincil (Windows'a kurulu PWA) |
| Egzersiz verisi | **ExerciseDB açık kaynak** (1500 egzersiz + GIF) + **wger** kas SVG diyagramları; görseller Supabase Storage'a kopyalanır |
| Antrenman akışı | Programı adım adım rehberli akış olarak uygula: egzersiz → set başlat → kaydet → mola zamanlayıcı → sonraki set/egzersiz |

---

## 1. Ürün İsterleri

### 1.1 Fonksiyonel isterler (modüller)

**M1 — Antrenman takibi (çekirdek)**
- Egzersiz kütüphanesi: **ExerciseDB açık kaynak** kataloğu (1500 egzersiz, her biri GIF animasyonlu, adım adım talimat, hedef/ikincil kaslar, vücut bölgesi, ekipman) Supabase'e içe aktarılır (bkz. §2.2). Kullanıcı kendi egzersizini de ekleyebilir. Filtreler: vücut bölgesi, hedef kas, ekipman, arama.
- Egzersiz detay ekranı: **GIF** (nasıl yapılır) + **kas diyagramı** (wger ön/arka vücut silueti üzerinde hedef kas koyu, ikincil kas açık renk boyalı → "hangi bölgeyi çalıştırıyor") + talimat adımları (EN; TR çevirisi kullanıcı tarafından düzenlenebilir).
- Program şablonları: ör. Push / Pull / Legs; her gün için egzersiz sırası + hedef set/tekrar + set arası mola süresi.
- **Gün bazlı plan** (2026-10-26 eklendi): Şablon haftanın bir veya birkaç gününe atanır (ör. "Pazartesi: Push"). Antrenman sekmesi ve Özet ekranı o günün planını "Bugünün antrenmanı" kartıyla gösterir; tek dokunuşla o plandan seans başlar.
- **Son ağırlık takibi**: Seans başlarken ve her egzersize geçişte, o egzersizde en son kullanılan ağırlık × tekrar setleri görünür ve set alanları bu değerlerle önceden doldurulur.
- **Egzersiz gelişim sayfası**: Her egzersizin kendi sayfasında tarih bazlı grafik: her seansın ortalama çalışma ağırlığı, en yüksek ağırlık ve tahmini 1RM; seçilebilir dönem (4 hafta / 3 ay / 1 yıl / tümü) için dönem ortalaması çizgisi ve özet kutuları (ortalama, en iyi, değişim %). Altında seans listesi (tarih, setler).
- **Rehberli antrenman akışı** (çekirdek UX): şablondan "Antrenmanı başlat" → ekranda tek seferde tek egzersiz: GIF küçük, önceki seans değerleri, hedef set/tekrar. "Seti başlat" → kg × tekrar (+ RPE opsiyonel) gir → "Seti bitir" → mola zamanlayıcı otomatik başlar (büyük geri sayım, titreşim/ses, "molayı atla/+30 sn") → sonraki set veya "Sonraki egzersiz" → program bitince özet (süre, toplam hacim, PR'lar). Akış telefon kilitlenip açılsa da kaldığı yerden devam eder (taslak seans local'de saklanır).
- Boş seans da başlatılabilir (şablonsuz, egzersiz ekleyerek).
- Antrenman geçmişi: "ne zaman, hangi egzersizi, kaç set × tekrar × kg" takvim + liste görünümü; egzersiz başına zaman serisi grafiği (ağırlık ve hacim trendi).
- Kardiyo seansı: tip (koşu, bisiklet, yürüyüş…), süre, mesafe, ortalama nabız (manuel).
- Kişisel rekor (PR) tespiti: egzersiz başına en yüksek kg / tahmini 1RM, yeni PR'da bildirim.
- Geçmiş: takvim görünümü + seans detayları, düzenleme/silme.

**M1b — Antrenman kalorisi ve günlük enerji** (2026-10-25 eklendi, Faz 2'nin ilk adımı)
- Her bitirilen seans için tahmini yakılan kalori veritabanında hesaplanır ve seansa yazılır; istemci değiştiremez. Formül: MET × kg × saat (2024 Fiziksel Aktivite Kompendiyumu). Ağırlık antrenmanı: ortalama RPE < 7 → 3,5, RPE yok veya 7–8,4 → 5,0, ≥ 8,5 → 6,0; süre dinlenmeler dahil, en fazla 3 saat, en az 1 çalışma seti. Kardiyo: aktivite + hız bandı (mesafe varsa), en fazla 4 saat; nabız, kilo, cinsiyet ve yaş biliniyorsa Keytel (2005) nabız denklemi.
- Kilo kaynağı: önce son kilo kaydı (M2 gelince), yoksa onboarding başlangıç kilosu, o da yoksa 70 kg varsayımı (ekranda belirtilir).
- **Günlük kalori takibi**: "Yenilen" (M3) ve "Yakılan" (antrenmanlar) günlük olarak **ayrı ayrı** gösterilir; antrenman kalorisi yeme hedefine eklenmez, birbirinden düşülmez (kullanıcı kararı). Kalori puan kazandırmaz.
- Faz 2 sırası: 1) antrenman kalorisi, 2) vücut ölçüleri/kilo, 3) beslenme + Gemini + günlük enerji kartı (yenilen | yakılan), 4) uyku/su, 5) şifreli fotoğraflar.

**M2 — Vücut metrikleri** (2026-10-25 uygulandı: Takip > Vücut; günde tek satır, hedef kilo `profile_private.target_weight_kg`, yalnızca kg/cm)
- Kilo (günlük), bel/göğüs/kol/kalça/uyluk ölçüleri (haftalık).
- Trend grafiği, 7 günlük hareketli ortalama, hedef kilo çizgisi.

**M3 — Beslenme**
- Günlük kalori + protein/karbonhidrat/yağ manuel girişi (öğün bazlı, barkod yok).
- Kullanıcının kendi "sık yediğim yiyecekler" listesi (hızlı tekrar giriş).
- **AI besin tahmini (Gemini)**: Yemek ismi yazarak ("2 yumurta, 1 dilim tam buğday ekmek") veya **yemek fotoğrafı** çekerek kalori + protein/karbonhidrat/yağ tahmini alınır; sonuç düzenlenebilir ve tek dokunuşla öğüne eklenir, istenirse sık yiyeceklere kaydedilir. Aynı `ai-coach` Edge Function'ın `food-estimate` aksiyonu üzerinden çalışır (Gemini çok modlu, ücretsiz katman); OpenRouter yedeği yalnızca metin için. Yemek fotoğrafı yalnızca tahmin için gönderilir, saklanmaz. Kota bitince manuel giriş her zaman açık.
- Günlük hedef (kcal ve makro) ve kalan miktar göstergesi.

**M4 — Uyku ve su**
- Uyku: yatış/kalkış saati, süre otomatik, 1–5 kalite puanı.
- Su: hızlı "+250 ml" butonları, günlük hedef, ilerleme halkası.

**M5 — Alışkanlıklar**
- Kullanıcı tanımlı alışkanlıklar (okuma, meditasyon…), sıklık (günlük / haftada N gün / belirli günler).
- Günlük işaretleme, streak sayacı, aylık ısı haritası.

**M6 — To-do**
- Tek seferlik görevler: başlık, not, son tarih, öncelik.
- Tekrarlı görevler: günlük / haftalık / aylık / özel kural (ör. her Pzt-Çar-Cum). Her tekrar ayrı tamamlanma kaydı tutar.
- "Bugün" görünümü: bugünkü to-do'lar + bugünkü alışkanlıklar tek listede.

**M7 — Dashboard (ana ekran)**
- Bugün: planlı antrenman, su, kalori kalan, uyku, bugünkü görevler.
- Haftalık özet: antrenman sayısı, toplam hacim (kg), kilo trendi, alışkanlık tamamlama %.
- Kural tabanlı öneriler (AI yok): ör. "3 gündür bacak çalışmadın", "su hedefinin %40'ındasın".

**M9 — Gelişim fotoğrafları (uçtan uca şifreli)**
- Periyodik fotoğraf çekme/yükleme (kamera veya galeri), tarih + opsiyonel kilo/not etiketi, poz tipi (ön/yan/arka).
- Zaman çizelgesi ve **yan yana karşılaştırma** (ör. 1 Ocak vs bugün), aynı poz tipinde kaydırıcıyla geçiş.
- **Sıfır bilgi şifreleme**: Fotoğraf, cihazda EXIF'i (konum, cihaz bilgisi) temizlenip yeniden boyutlandırılır, küçük önizleme (thumbnail) üretilir; hem fotoğraf hem önizleme hem de etiket/not metni **cihazda AES-256-GCM ile şifrelenir**, Supabase Storage ve DB'ye yalnızca şifreli bayt dizisi gider. Sunucu, Supabase personeli veya sızıntıyı ele geçiren kişi anahtarsız hiçbir şey göremez; dosya adı bile rastgele UUID'dir.
- **Anahtar yönetimi**: Kullanıcı bir "fotoğraf parolası" belirler. Parola → Argon2id (fallback PBKDF2-SHA256, 600k iterasyon) → anahtar sarmalama anahtarı; rastgele üretilen 256-bit ana anahtar bu anahtarla sarmalanıp (wrapped) DB'de saklanır. Parola ve açılmış ana anahtar yalnızca cihaz belleğinde / IndexedDB'de (cihaz bazlı "beni hatırla", kullanıcı kapatabilir) durur, **sunucuya asla gitmez**. Cihaz değişiminde parola girilince ana anahtar sarmaldan açılır, tüm fotoğraflar erişilir.
- **Kurtarma anahtarı**: Kurulumda bir kez gösterilen 24 kelimelik/Base32 kurtarma kodu ile ikinci bir sarmal saklanır. Parola unutulur ve kurtarma kodu da yoksa fotoğraflar **kalıcı olarak kaybolur**; bu açıkça uyarılır (bilinçli tasarım tercihi, isterin gereği).
- Fotoğraflar PWA çevrimdışı önbelleğine **şifresiz asla yazılmaz**; görüntüleme bellekte çözülür, `blob:` URL'si kapatınca iptal edilir.

**M10 — AI koç (ücretsiz katman LLM)**
- Sohbet: "Bu hafta nasıl gittim?", "Omuz programımı düzenle", "Bugün ne yiyeyim?" gibi sorular; bağlam olarak son 4 haftanın antrenman/kilo/beslenme/uyku özeti otomatik eklenir (fotoğraflar **asla** gönderilmez).
- Haftalık değerlendirme kartı (dashboard'da, haftada 1 otomatik üretim) ve program önerisi (şablon olarak kaydedilebilir, JSON şema ile doğrulanır).
- Sağlayıcı soyutlaması: `gemini` (birincil, Google AI Studio ücretsiz API anahtarı) ve `openrouter` (yedek, `:free` modeller). Kota/429 durumunda otomatik yedeğe geç, o da yoksa kural tabanlı öneriler.
- **Anahtar güvenliği**: Sağlayıcı API anahtarları istemciye girmez; **Supabase Edge Function** (`ai-coach`, Deno, ücretsiz katman 500k çağrı/ay) içinde Supabase Secrets'tan okunur. Fonksiyon JWT'yi doğrular ve yalnızca beyaz listedeki e-postaya hizmet verir; günlük istek sayacı (`ai_usage`) ile ücretsiz kota aşımı engellenir.
- Konuşma geçmişi `ai_conversations` / `ai_messages` tablolarında (RLS), istenirse silinebilir.

**M11 — Profil ve onboarding**
- Google ile ilk girişten hemen sonra `/onboarding`: kullanıcı adı (benzersiz, 3–20 karakter, küçük harf/rakam/alt çizgi), görünen ad, **profil fotoğrafı zorunlu** (kamera/galeri; "Google fotoğrafımı kullan" kısayolu Google avatarını Storage'a kopyalar), opsiyonel: boy, doğum yılı, cinsiyet, hedef (kilo ver / kas kazan / form koru), liderlik tablosunda görünürlük (varsayılan açık).
- Fotoğraf istemcide 512×512 kare kırpılır, EXIF temizlenir, WebP/JPEG olarak `avatars/{user_id}.jpg` bucket'ına yüklenir (herkese okunur, yalnızca sahibine yazılır).
- Onboarding tamamlanmadan (`profiles.onboarding_completed_at is null`) uygulama rotaları açılmaz.
- Profil düzenleme Ayarlar altında; kullanıcı adı değişikliği 30 günde 1.

**M12 — Puan sistemi ve liderlik tablosu**
- Puanlar **sunucu tarafında** (Postgres trigger'ları) yazılır; istemci puan ekleyemez (RLS: `point_events` kullanıcıya salt okunur). Kurallar §1.4.
- Seviye = `floor(toplam_puan / 1000) + 1`; seviye atlayınca kutlama ekranı.
- Liderlik tablosu: **Haftalık** (Pzt–Paz), **Aylık**, **Tüm zamanlar**; ilk 50 + kullanıcının kendi sırası. Satırda: avatar, görünen ad, puan, seviye, aktif gün sayısı. Veri `get_leaderboard(period)` RPC'sinden gelir; yalnızca herkese açık profil alanları döner. `show_on_leaderboard = false` olan kullanıcılar listelenmez ama kendi sıralarını görür.
- Rozetler (Faz 4): "İlk antrenman", "7 gün seri", "30 gün seri", "100 set", "10 gelişim fotoğrafı".
- Anti-hile: günlük toplam tavan, aynı gün aynı olaya tekrarlı puan yok, geri tarihli kayıtlar (>2 gün) puan kazandırmaz, silinen kayıtların puanı geri alınır.

**M13 — Yönetim (ürün sahibi)**
- **Kayıt onayı** (2026-10-25 eklendi, Faz 0'da uygulandı): Onboarding tamamlanan her yeni hesap `status = 'pending'` ile başlar ve "Onay bekleniyor" ekranında kalır; yalnızca kendi profil satırını okuyabilir, başka hiçbir tabloya erişemez (`can_access()` onaylı olmayı şart koşar). Yönetici Ayarlar → Yönetim → **Kayıt istekleri**'nde (Bekleyen / Onaylı / Reddedilen sekmeleri, e-posta görünür) onaylar veya reddeder; bekleyen sayısı rozet olarak görünür. `app_config.require_approval` kapatılırsa yeni hesaplar doğrudan onaylı olur. Yönetici hesaplar her zaman onaylıdır; yönetici kendi durumunu değiştiremez.
- `profiles.role = 'admin'` olan kullanıcı Ayarlar → Yönetim'de ayrıca (Faz 4): erişim modu (`open`/`invite`), beyaz liste yönetimi, kullanıcı engelleme (`is_blocked`), AI günlük global kota, kullanım özeti (kullanıcı sayısı, Supabase/AI kota yüzdesi).

**M8 — Ayarlar**
- Dil (TR/EN), birim (kg/lb, cm/in), günlük hedefler, haftanın başlangıç günü, AI sağlayıcı tercihi, fotoğraf parolası / kurtarma kodu yönetimi, liderlik görünürlüğü, profil düzenleme, hesabı sil (tüm veriler + Storage dosyaları kaskad silinir).

### 1.4 Puanlama kuralları (ürün sahibi kararı)

| Olay | Puan | Tavan / kural |
|---|---|---|
| Ağırlık antrenmanı seansı tamamlandı | 50 + 2 × set | En az 3 çalışma seti (ısınma sayılmaz); seans başına en fazla 100; günde en fazla 2 seans puanlanır |
| Kardiyo seansı | 30 + 1 puan / 5 dk | En az 10 dk; seans başına en fazla 60 |
| Yeni kişisel rekor (PR) | 20 | Egzersiz başına günde 1, günde en fazla 40. Bir egzersizin ilk kaydı referans olur (PR puanı yok); kullanıcının kendi eklediği egzersizler PR puanı vermez |
| Kilo kaydı | 10 | Günde 1 |
| Vücut ölçüsü kaydı | 15 | Haftada 1 |
| Öğün kaydı | 5 | Günde en fazla 20 (4 öğün) |
| Günlük protein hedefi tutturuldu | 15 | Günde 1, hedef tanımlıysa |
| Su hedefi tamamlandı | 10 | Günde 1 |
| Uyku kaydı | 5 (+5 eğer ≥ 7 saat) | Günde 1 |
| Alışkanlık tamamlandı | 10 | Günde en fazla 50 |
| Görev (to-do) tamamlandı | 5 | Günde en fazla 30 |
| Gelişim fotoğrafı | 25 | Haftada 1 |
| 7 gün ardışık aktif gün | 50 bonus | Her 7. günde |
| 30 gün ardışık aktif gün | 250 bonus | Her 30. günde |
| **Günlük toplam tavan** | **300** | Bonuslar tavana dahil değil |

"Aktif gün" = o gün en az 1 puanlı olay (seri bonusları sayılmaz). Gün, yerel takvim günüdür (Europe/Istanbul; tüm kullanıcıların Türkiye'de olduğu varsayılır, kullanıcı bazlı saat dilimi ileride). Seans, başladığı yerel güne yazılır; en fazla 2 gün geriye. Bir seans yalnızca bir kez bitirilebilir; istemci seans süresini/toplamlarını değiştiremez. AI kullanımı puan kazandırmaz. Kayıt silinirse ilgili puan olayı da silinir, seri yeniden hesaplanır ve artık hak edilmeyen seri bonusları geri alınır; günlük tavanlar yeniden hesaplanmaz (basitlik).
- Veri dışa aktarma (JSON/CSV indirme) — kullanıcı verisinin kilidi her zaman kullanıcıda.

### 1.2 Fonksiyonel olmayan isterler

- **Erişim kontrolü ve izolasyon**: Google OAuth zorunlu. `app_config.access_mode = 'open'` iken Google ile giren herkes kayıt olur; `'invite'` iken yalnızca `allowed_emails` (DB trigger'ı kayıt anında engeller). Engellenen (`is_blocked`) kullanıcı hiçbir satır okuyamaz. Her kullanıcı tablosunda RLS `user_id = auth.uid() and public.can_access()`. Başka kullanıcının verisine erişim yalnızca `profiles` herkese açık alanları ve `get_leaderboard()` RPC'si üzerinden, sadece özet puan bilgisi.
- **Maliyet**: 0 TL/ay. Tüm servisler ücretsiz katmanda kalacak şekilde seçilir ve limitleri belgelenir.
- **Mobil öncelikli**: PWA, telefona "ana ekrana ekle" ile kurulur, çevrimdışı açılır (son görünen veri cache'te), bağlantı gelince senkronlar.
- **Hız**: Spor salonunda set kaydı ≤ 2 dokunuş; büyük dokunma alanları.
- **Taşınabilirlik**: Veri Postgres'te, dışa aktarma her zaman mümkün; vendor lock-in düşük.

- **iPhone 16 birincil**: 393×852 pt viewport, `env(safe-area-inset-*)` ile Dynamic Island / home bar boşlukları, 100dvh, Safari PWA ("Ana Ekrana Ekle") kısıtları gözetilir (push yok, 50 MB cache sınırı dikkate alınır). Masaüstü: Windows'a Edge/Chrome ile kurulu PWA, geniş ekranda iki sütunlu düzen.
- **Gizlilik**: Fotoğraflar uçtan uca şifreli (M9); AI'a fotoğraf veya ham kimlik bilgisi gönderilmez; tüm üçüncü taraf anahtarlar sunucu tarafında.

### 1.3 Kapsam dışı (şimdilik)
Barkod okuma, çoklu kullanıcı, native mağaza uygulaması, giyilebilir cihaz entegrasyonu, bildirim sunucusu (push), fotoğraf üzerinde AI analizi.

---

## 2. Teknoloji ve ücretsiz platform kararları

| Katman | Seçim | Neden | Ücretsiz limit / risk |
|---|---|---|---|
| Frontend | **React 19 + Vite + TypeScript** | Hızlı, geniş ekosistem, PWA desteği kolay | — |
| UI | **Tailwind CSS + shadcn/ui** | Mobil uyumlu hazır bileşenler, tema | — |
| State/veri | **TanStack Query** + Supabase JS | Cache, optimistic update, offline kuyruğu için temel | — |
| Grafik | **Recharts** | Hafif, React-native | — |
| i18n | **react-i18next** | Standart, lazy-load dil dosyaları | — |
| PWA | **vite-plugin-pwa** (Workbox) | Service worker, manifest, offline cache | — |
| Form/validasyon | **react-hook-form + zod** | Tip güvenli form | — |
| Backend + DB + Auth | **Supabase (Free)** | Postgres + Google OAuth + RLS tek yerde, sunucu kodu yok | 500 MB DB, 50k MAU. **7 gün inaktif projede pause** → GitHub Actions ile günlük keep-alive ping |
| Sunucu kodu | **Supabase Edge Functions** (Deno) | Yalnızca AI proxy için; anahtarları gizler | 500k çağrı/ay |
| AI | **Google Gemini API** (AI Studio ücretsiz anahtar) + **OpenRouter** `:free` modeller | Ücretsiz katman; sağlayıcı soyutlaması ile değiştirilebilir | Gemini günlük istek kotası (model bazlı, Faz 4'te güncel değer belgelenir); OpenRouter free ~50 istek/gün |
| Şifreleme | **WebCrypto** (AES-256-GCM) + **argon2-browser** (WASM) | Tarayıcı yerleşik, bağımlılık yok; Argon2id parola türetme | — |
| Hosting | **Vercel (Hobby)** | Git push = deploy, SPA için sıfır config, HTTPS | Kişisel/ticari olmayan kullanım şartı (bize uygun). Alternatif: Cloudflare Pages |
| Kaynak kodu | **GitHub (private repo)** | Ücretsiz private repo + Actions | Actions 2000 dk/ay |
| Google OAuth | **Google Cloud Console** | OAuth Client ID (ücretsiz) | — |

**Mimari**: Saf SPA + Supabase. Ayrı backend yok; tüm iş kuralları ya istemcide ya da Postgres fonksiyonları/trigger'larında. Bu, ücretsiz katmanda kalmanın en güvenli yolu.

### 2.1 Erişim ve izolasyon modeli (çok kullanıcılı)

1. **Supabase Auth**: Yalnızca Google provider açık; sign-up açık (erişim modu DB'de yönetilir).
2. **Erişim modu** `public.app_config(access_mode)`: `open` → herkes; `invite` → `auth.users` `before insert` trigger'ı beyaz liste dışını reddeder. Yönetici Ayarlar → Yönetim'den değiştirir (`service_role` gerekmez; `is_admin()` RLS politikası).
3. **`public.can_access()`**: `auth.uid()` var **ve** `profiles.is_blocked = false` (profil henüz yoksa true, onboarding yapılabilsin). Her kullanıcı tablosunun RLS'i `user_id = auth.uid() and can_access()`.
4. **Herkese açık profil**: `profiles` tablosunda `select` tüm `authenticated` için açık; ancak tabloda yalnızca paylaşılabilir alanlar (username, display_name, avatar_path, level, total_points, show_on_leaderboard, role) bulunur. Özel alanlar (`birth_year`, `height_cm`, `sex`, `goal`) ayrı `profile_private` tablosunda, yalnızca sahibine açık.
5. **Onboarding kapısı** (istemci + RLS): `onboarding_completed_at is null` ise rotalar `/onboarding`'e yönlenir; puan trigger'ları profil yoksa puan yazmaz.
6. **Yönetici**: `profiles.role = 'admin'`; ilk kayıt olan kullanıcı otomatik admin (seed ile e-posta belirtilir), sonra yalnızca admin başka admin atar.

`anon` key istemcide görünür olacak (Supabase'in normal modeli); güvenlik RLS'tendir, key gizliliğinden değil. `service_role` key hiçbir zaman istemciye girmez.

### 2.2 Egzersiz kataloğu: ExerciseDB (açık kaynak) + wger kas diyagramları

Kullanıcı kararı: ExerciseAPI yerine GIF'li kaynak. Değerlendirilen alternatifler: ExerciseAPI (görselsiz, 100 istek/gün), free-exercise-db (kamu malı, 2 fotoğraf/egzersiz), wger (TR çeviri + kas SVG, görsel az, video MOV), ExerciseDB OSS (GIF, 1500 egzersiz). **Seçim: ExerciseDB OSS + wger.**

**Kaynak A — ExerciseDB açık kaynak** (`https://oss.exercisedb.dev/api/v1`, doğrulandı 2026-10-25)
- `GET /exercises?limit=100&cursor=…` (cursor sayfalama, `meta.total = 1500`), `GET /muscles` (38 kas), `GET /bodyparts` (10 bölge), `GET /equipments`.
- Alanlar: `exerciseId`, `name`, `gifUrl` (`https://static.exercisedb.dev/media/{id}.gif`, ~67 KB), `bodyParts[]`, `equipments[]`, `targetMuscles[]`, `secondaryMuscles[]`, `instructions[]`.
- Anahtarsız, CORS açık, rate-limit başlığı görülmedi. **Risk**: GIF lisansı belirsiz, üçüncü taraf hosting kapanabilir → bu yüzden GIF'ler Supabase Storage'a kopyalanır (1500 × ~67 KB ≈ 100 MB, 1 GB ücretsiz limite sığar). Kişisel kullanım; Hakkında ekranında kaynak gösterilir.

**Kaynak B — wger** (`https://wger.de/api/v2`, salt okunur anahtarsız)
- `GET /muscle/` → 15 kas: `name`, `name_en`, `is_front`, `image_url_main`, `image_url_secondary` (vücut silueti üzerine binen SVG katmanları). Lisans CC-BY-SA; atıf Hakkında ekranında.
- Kas diyagramı bileşeni: ön/arka silüet taban görseli + ExerciseDB `targetMuscles` → wger kas id eşlemesi (`src/features/exercises/muscleMap.ts`, 38 → 15 elle eşleme; eşleşmeyenler diyagramda gösterilmez, metin olarak listelenir) → `image_url_main` (hedef, koyu) ve `image_url_secondary` (ikincil, açık) katmanları üst üste.
- 15 SVG + 2 silüet dosyası Storage'a kopyalanır.

**Senkron akışı** — `scripts/sync-exercises.ts` (Node, `service_role` ile)
1. ExerciseDB'yi cursor ile tamamen çek (15 istek) → `exercises` tablosuna `upsert` (`external_id = exerciseId`, `source = 'exercisedb'`).
2. Her egzersiz için GIF'i indir → Supabase Storage `exercise-media/gifs/{exerciseId}.gif` olarak yükle (varsa atla) → `gif_path` yaz.
3. wger `/muscle/` → `muscles` tablosuna upsert + SVG'leri `exercise-media/muscles/` altına kopyala.
4. `exercise_catalog_meta` güncelle (kaynak, sayım, `synced_at`).
5. GitHub Actions `sync-exercises.yml`: **ayda 1** + manuel tetikleme; `service_role` key yalnızca GitHub Secrets'ta.
6. Kullanıcı egzersizleri (`is_custom = true`) senkronda dokunulmaz. Uygulama her zaman kendi DB + Storage'ından okur; kaynaklar kapansa bile çalışır.

**Dil**: Kaynak İngilizce. `name_tr` ve `instructions_tr` boş başlar; en yaygın ~100 egzersiz için seed çevirisi (`supabase/seed.sql`), kalanı kullanıcı egzersiz detayından düzenleyebilir. TR arayüzde `name_tr ?? name_en` gösterilir.

**RLS**: Katalog satırları (`is_custom = false`) beyaz listeli kullanıcıya salt okunur; `is_custom = true` satırlar `user_id = auth.uid()` ile tam yetkili. Storage `exercise-media` bucket'ı: okuma sadece authenticated + beyaz liste, yazma sadece `service_role`.

---

## 3. Veri modeli (özet)

Tüm tablolarda: `id uuid pk`, `user_id uuid references auth.users`, `created_at`, `updated_at`; hepsi RLS'li.

- `app_config(key pk, value jsonb)` — `access_mode`, `ai_global_daily_limit`, `admin_bootstrap_email`
- `allowed_emails(email pk, note, added_by)` — yalnızca `invite` modunda etkili
- `profiles(user_id pk, username unique, display_name, avatar_path not null, role user|admin, is_blocked, show_on_leaderboard, total_points, level, current_streak, longest_streak, last_active_on, onboarding_completed_at, username_changed_at)` — herkese açık alanlar
- `profile_private(user_id pk, birth_year?, height_cm?, sex?, goal?)` — yalnızca sahibi
- `point_events(id, user_id, kind, points, occurred_on date, ref_table, ref_id, created_at)` — trigger'lar yazar, istemci salt okunur; `unique(user_id, kind, ref_table, ref_id)`
- `point_rules(kind pk, points, per_event_cap, daily_cap, weekly_cap, is_active)` — §1.4 tablosunun DB karşılığı, admin düzenleyebilir
- RPC `get_leaderboard(period text, limit int)` → `(rank, user_id, username, display_name, avatar_path, points, level, active_days)`; `security definer`, yalnızca `show_on_leaderboard` olanlar
- Storage bucket `avatars` (okuma: authenticated; yazma: `{user_id}/*` sahibi)
- `exercises(external_id?, source, name_en, name_tr?, body_parts[], target_muscles[], secondary_muscles[], equipment[], instructions_en[], instructions_tr[]?, gif_path?, is_custom, user_id?)` — detay §2.2
- `muscles(wger_id pk, name_latin, name_en, name_tr, is_front, svg_main_path, svg_secondary_path)` + `muscle_aliases(exercisedb_name pk, wger_id)` (38→15 eşleme)
- `exercise_catalog_meta(source pk, item_count, synced_at, license_text)`
- `workout_templates(name, notes)` → `template_exercises(template_id, exercise_id, order, target_sets, target_reps)`
- `workout_sessions(started_at, ended_at, template_id?, notes, kind: strength|cardio)`
- `session_sets(session_id, exercise_id, set_no, weight_kg, reps, rpe?)`
- `cardio_entries(session_id, type, duration_sec, distance_m, avg_hr?)`
- `body_metrics(date, weight_kg?, waist_cm?, chest_cm?, arm_cm?, hip_cm?, thigh_cm?)`
- `foods(name, kcal, protein_g, carb_g, fat_g, serving_desc)` → `meal_entries(date, meal_slot, food_id?, free_text?, kcal, protein_g, carb_g, fat_g)`
- `sleep_entries(date, bed_at, wake_at, quality 1-5)`
- `water_entries(date, amount_ml, logged_at)`
- `habits(name, frequency_rule jsonb, color, archived)` → `habit_logs(habit_id, date)`
- `todos(title, notes, due_date?, priority, recurrence_rule jsonb?, archived)` → `todo_completions(todo_id, date)`
- `user_settings(user_id pk, locale, unit_weight, unit_length, daily_kcal, daily_protein_g, daily_water_ml, week_starts_on, ai_provider, ai_daily_limit)`
- `photo_vault(user_id pk, kdf jsonb{alg, salt, params}, wrapped_master_key bytea, recovery_wrapped_key bytea, recovery_salt bytea, created_at)` — anahtar sarmalları; düz anahtar asla yok
- `progress_photos(id, user_id, taken_at, pose, storage_path, thumb_path, iv bytea, thumb_iv bytea, encrypted_meta bytea, meta_iv bytea)` — Storage bucket `progress-photos/{user_id}/{uuid}.bin`, içerik yalnızca şifreli
- `ai_conversations(id, user_id, title, created_at)` → `ai_messages(conversation_id, role, content, provider, model, tokens, created_at)`
- `ai_usage(user_id, date, request_count)` — günlük kota sayacı (Edge Function yazar)

Migration'lar `supabase/migrations/*.sql` dosyalarında, Supabase CLI ile uygulanır; şema repo'da versiyonlanır.

---

## 4. Proje yapısı

```
my-trainer/
  .claude/
    agents/          # alt ajanlar (bkz. §5)
    skills/          # proje skill'leri (bkz. §5)
    settings.json
  CLAUDE.md          # proje kuralları, komutlar, mimari özet
  supabase/
    migrations/      # SQL şema + RLS + trigger
    seed.sql         # TR egzersiz adı çevirileri (name_tr), varsayılan ayarlar
  scripts/
    sync-exercises.ts  # ExerciseDB + wger → Supabase DB & Storage senkronu (§2.2)
  supabase/functions/
    ai-coach/        # Edge Function: Gemini/OpenRouter proxy, JWT + beyaz liste + kota
  src/
    app/             # router, providers, layout (mobil alt tab bar)
    features/
      auth/  workouts/  body/  nutrition/  sleep-water/  habits/  todos/  dashboard/  settings/
      (her feature: components/, hooks/, api.ts, schema.ts)
    lib/             # supabase client, i18n, utils, date helpers
    locales/tr/*.json  locales/en/*.json
  .github/workflows/
    ci.yml           # lint + typecheck + test
    keepalive.yml    # günlük Supabase ping
    sync-exercises.yml  # haftalık ExerciseAPI katalog senkronu
```

---

## 5. Alt ajanlar ve skill'ler (görev dağıtımı)

Ürün sahibi (ben) koordine eder; uygulama işi şu alt ajanlara dağıtılır. Faz 0'da `.claude/agents/*.md` ve `.claude/skills/*/SKILL.md` olarak oluşturulur.

| Ajan | Sorumluluk |
|---|---|
| `db-architect` | Supabase migration'ları, RLS politikaları, trigger'lar, seed verisi. Her tablo için RLS testi yazar. |
| `frontend-dev` | React feature modülleri, mobil UI, formlar, grafikler, i18n anahtarları. |
| `qa-reviewer` | Her faz sonunda kod incelemesi: güvenlik (RLS boşluğu, service key sızıntısı), erişilebilirlik, mobil kullanılabilirlik. Salt-okunur. |
| `i18n-checker` | TR/EN dosyalarının eş anahtarlı olduğunu, eksik çeviri olmadığını doğrular. |

| Skill | Ne yapar |
|---|---|
| `/db-migrate` | Yeni migration dosyası oluşturur, RLS şablonunu otomatik ekler, lokal Supabase'e uygular. |
| `/new-feature <ad>` | `src/features/<ad>` iskeletini (api/hooks/components/schema + locale anahtarları) üretir. |
| `/release-check` | typecheck + lint + test + build + i18n kontrolü + RLS smoke testi; hepsi yeşilse deploy'a hazır der. |

---

## 6. Geliştirme fazları (her faz sonunda onay alınır)

**Faz 0 — İskelet, kimlik, profil ve puan altyapısı** *(önce bu, çünkü her şey buna oturur)*
- Vite + React + TS + Tailwind + shadcn + i18n + PWA iskeleti; mobil alt sekme navigasyonu (Özet / Antrenman / Takip / Bugün / Liderlik; Ayarlar üst sağda).
- Supabase: Google OAuth, `app_config` + erişim modu trigger'ı, `can_access()` / `is_admin()`, `profiles` + `profile_private` + `avatars` bucket, `user_settings`, `point_rules` + `point_events` + `get_leaderboard()` RPC, puan motoru çekirdeği (`award_points()` fonksiyonu; modül trigger'ları ilgili fazda eklenir).
- Onboarding akışı (zorunlu avatar, kullanıcı adı benzersizlik kontrolü), "Erişim yok / engellendi" ekranı.
- `.claude/agents`, `.claude/skills`, `CLAUDE.md`, CI + CD (GitHub Actions → Supabase migrations + Edge Functions + Vercel), keep-alive workflow.
- Vercel'e ilk deploy → telefondan Google ile giriş + onboarding tamamlanıyor.
- **Çıktı**: Yayında, çok kullanıcılı, profil ve puan altyapısı hazır ama modülleri boş uygulama.

**Faz 1 — Antrenman modülü (M1) + Liderlik tablosu UI (M12)**
- Antrenman/kardiyo/PR puan trigger'ları, liderlik sayfası (hafta/ay/tümü), profil kartı (seviye, seri).
- ExerciseDB + wger senkron scripti, GIF/SVG'lerin Storage'a kopyalanması, 38→15 kas eşlemesi, `name_tr` seed çevirisi (~100 egzersiz), kaynak atıf ekranı.
- Egzersiz kütüphanesi UI (bölge / kas / ekipman filtreleri, arama), egzersiz detayı (GIF + kas diyagramı + talimat), şablonlar, **rehberli antrenman akışı** (set başlat / bitir / mola zamanlayıcı / sonraki), kesintiye dayanıklı taslak seans, kardiyo, PR tespiti, geçmiş + egzersiz trend grafiği.

**Faz 2 — Vücut, beslenme, uyku/su, gelişim fotoğrafları (M2, M3, M4, M9)**
- Üç basit kayıt modülü + grafikler + günlük hedef göstergeleri.
- Fotoğraf kasası: parola kurulumu + kurtarma kodu, Argon2id/AES-GCM şifreleme kütüphanesi (`src/lib/crypto/`), EXIF temizleme + yeniden boyutlandırma, şifreli yükleme/indirme, zaman çizelgesi + karşılaştırma. Birim test: şifrele→çöz, yanlış parola reddi, sunucuya giden her baytın şifreli olduğunu doğrulayan test.

**Faz 3 — Alışkanlık ve To-do (M5, M6)**
- Tekrar kuralı motoru (ortak: habit ve todo aynı `recurrence_rule` yapısını kullanır), "Bugün" listesi, streak, ısı haritası.

**Faz 4 — Dashboard, AI koç, offline, dışa aktarma (M7, M8, M10)**
- Ana ekran kartları, haftalık özet, kural tabanlı öneriler, offline yazma kuyruğu, JSON/CSV export, ayarlar.
- `ai-coach` Edge Function (Gemini + OpenRouter sağlayıcı soyutlaması, JWT/beyaz liste/kota), bağlam özeti üretici, sohbet UI, haftalık değerlendirme kartı, program önerisi → şablon kaydı. Kullanıcıdan Gemini ve OpenRouter ücretsiz API anahtarlarını Supabase Secrets'a girmesi istenir.

**Faz 5 — Sertleştirme ve yayın**
- `qa-reviewer` tam tur, Lighthouse PWA skoru, Supabase sign-up kapatma, son RLS denetimi, kullanım kılavuzu (README).

---

## 6.1 CI/CD (GitHub Actions)

- `ci.yml`: her push ve PR'da typecheck + lint + test + i18n parity + build + gizli anahtar taraması + RLS sanity. PR'larda Vercel **preview** deploy ve PR yorumu.
- `deploy.yml`: `main` dalında CI başarılı olunca (`workflow_run`) → Supabase `db push` + `functions deploy` → Vercel **production** deploy. `workflow_dispatch` ile elle de tetiklenir.
- Akış: Claude feature dalında geliştirir → kullanıcı onayı → push + PR → CI/preview → kullanıcı merge eder (veya onay verir) → production otomatik.
- Gereken GitHub Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, keep-alive için `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

## 7. Kullanıcının yapması gerekenler (hesap oluşturma/yetki — ben yapamam)

Faz 0 başlamadan önce:
1. **GitHub**: private repo (`my-trainer`) oluştur veya bana boş repo URL'si ver.
2. **Supabase**: ücretsiz proje oluştur; Project URL + anon key'i `.env.local` dosyasına koy (ben dosya şablonunu hazırlarım, değerleri sen yazarsın).
3. **Google Cloud Console**: OAuth 2.0 Client ID (Web) oluştur, Supabase'in verdiği callback URL'yi ekle; Client ID/Secret'ı Supabase Auth → Google provider'a yapıştır.
4. **Vercel**: GitHub ile giriş yapıp repo'yu import et (tek tık).

Bu adımları ben yönlendireceğim; kimlik bilgisi girişini sen yapacaksın.

---

## 8. Doğrulama

- **Şifreleme**: Storage'daki bir fotoğraf dosyası indirilip incelenir → geçerli görüntü başlığı (JPEG/PNG magic bytes) içermemeli; DB'de hiçbir düz anahtar/parola bulunmamalı; yanlış parola ile açma denemesi başarısız olmalı; yeni cihazda parola ile tüm fotoğraflar açılmalı.
- **AI**: Tarayıcı ağ sekmesinde Gemini/OpenRouter'a doğrudan istek olmamalı (yalnızca Edge Function'a); beyaz liste dışı JWT ile Edge Function 403 dönmeli; günlük limit aşımında 429 + kural tabanlı öneri.
- **Güvenlik / izolasyon**: İki farklı Google hesabıyla giriş → A kullanıcısı B'nin hiçbir antrenman/kilo/öğün/fotoğraf satırını okuyamamalı (pgTAP: `supabase/tests/rls.test.sql`); `invite` modunda beyaz liste dışı hesap oluşmamalı; engellenen kullanıcı sıfır satır görmeli; istemciden `point_events` insert denemesi RLS ile reddedilmeli; liderlik RPC'si yalnızca herkese açık alanları döndürmeli.
- **Onboarding**: Avatar yüklemeden "Devam" pasif; tamamlanmadan `/` rotası `/onboarding`'e yönlenmeli.
- **Test kapısı**: Her push'ta CI iki iş çalıştırır: (1) typecheck, lint, Vitest, i18n, build, gizli anahtar taraması; (2) GitHub runner'ında yerel Supabase kurulup tüm migration'lar uygulanır ve pgTAP veritabanı testleri çalışır. İkisinden biri kırılırsa production deploy başlamaz. Her yeni tablo/RPC/iş kuralı pgTAP ile, her saf hesaplama Vitest ile test edilir.
- **Fonksiyonel**: Her feature için Vitest birim testleri (tekrar kuralı motoru, 1RM hesabı, streak hesabı) + Playwright ile 1 akış/faz (ör. "seans başlat → 3 set gir → bitir → geçmişte gör").
- **PWA**: Lighthouse PWA denetimi ≥ 90; uçak modunda uygulama açılıyor ve son veriler görünüyor.
- **Mobil**: Tarayıcı paneli 375px emülasyonunda tüm ekranlar yatay kaydırma olmadan kullanılıyor.
- **Maliyet**: Supabase ve Vercel panellerinde ücretsiz katman kullanım yüzdeleri Faz 5'te belgelenir.
