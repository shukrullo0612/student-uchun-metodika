# II BOB amaliy qism uchun professional reja

## 2.1. Amaliy muhitni loyihalash va tajriba stendini yaratish

Maqsad:
- Asosiy saytga aralashmaydigan alohida test stend yaratish.

Joriy holat (bajarildi):
- Asosiy sayt: https://smartedumetod.uz/
- Yangi stend: https://smartedumetod.uz/hujum/login/
- Alohida backend service: hujum-lab (127.0.0.1:3002)
- Alohida DB: hujum_lab
- Nginx route: /hujum/api -> hujum-lab

Arxitektura:
- Frontend (hujum/login): bitta LMS login sahifasi va yagona tadqiqot oqimi.
- Backend (hujum/api): SQL injeksiya bo'yicha 4 ta bog'liq rejim (auth bypass, union leak, error probing, blind boolean).
- DB (hujum_lab): test foydalanuvchilar va izolyatsiya.

## 2.2. Zaif veb-dasturda SQL injeksiya holatlarini amaliy ko'rsatish

Ko'rsatish uchun holatlar:
- Auth bypass (login query concatenation)
- UNION asosida ma'lumot sizdirish (data leakage)
- SQL xatoliklarini ochiq ko'rsatish (error-based tahlil)
- Blind SQLi uchun boolean/timega o'xshash xulq signallari

Amaliy jadval (taklif):
- Har bir holat uchun:
  - Test maqsadi
  - Kutilgan natija
  - Real natija
  - Xavf darajasi

## 2.3. SQL injeksiyani aniqlash vositalari yordamida sinov o'tkazish

Vositalar:
- Burp Suite Community
- OWASP ZAP
- sqlmap (faqat o'z stendingizga)

Yig'iladigan metrikalar:
- Topilgan zaifliklar soni
- False positive holatlari
- Aniqlash vaqti
- Qamrov darajasi (endpoint coverage)

## 2.4. Himoya vositalarini joriy etish va zaiflikni bartaraf etish

Himoya bosqichi:
- SQL:
  - Prepared statements (parametrized query)
  - Input validation (length, format, allowlist)
  - Least privilege DB user
- Operatsion himoya:
  - Audit loglar
  - Rate limit
  - Centralized monitoring

## 2.5. Olingan natijalar hamda himoya vositalarining qiyosiy baholanishi

Qiyoslash mezonlari:
- Zaiflik topilishidan oldin/ keyin holat
- Attack success rate (oldin va keyin)
- Performance ta'siri (latency, CPU)
- Joriy etish murakkabligi va xarajat

Taklif qilinadigan final jadval:
- Zaiflik turi | Oldin holat | Himoya | Keyin holat | Izoh

## Qo'shimcha professional g'oyalar

- Ikki rejimli stend:
  - Vulnerable mode
  - Patched mode
- Real-time monitoring panel:
  - So'rovlar logi
  - Shubhali patternlar
- Repeatable test script:
  - Har bir test avtomatik qayta ishlatiladigan bo'lsin
- Reproducibility:
  - Har bir natijani screenshot + JSON log bilan birga saqlash

## Muhim cheklov

Bu stend ilmiy-amaliy tadqiqot uchun. Asosiy sayt kodlari bilan aralashmaslik tamoyili saqlanadi.
