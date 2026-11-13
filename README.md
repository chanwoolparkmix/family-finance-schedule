# 가족금융일정표

가족 대출의 납입일을 기록하고, 납입 7일·3일·1일 전에 휴대폰으로 알림(금액·이체계좌·대출이름)을 받는 웹앱입니다.

- 기록은 휴대폰 브라우저(localStorage)에 저장되고, 설정에서 JSON 백업/복원을 할 수 있습니다.
- 알림은 Supabase Edge Function(`server/`)이 매시간 점검해서 웹 푸시로 보냅니다.
- 아이폰은 iOS 16.4 이상에서 **홈 화면에 추가한 앱**으로 열어야 알림을 받을 수 있습니다.

## 구성
- `index.html`, `sw.js`, `manifest.webmanifest`, `icon-*.png`: 앱 (GitHub Pages로 배포)
- `server/`: 알림 발송 함수 (`fs-push`)
- `supabase/migration.sql`: 알림용 테이블과 예약 작업
