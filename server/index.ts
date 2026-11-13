// 가족금융일정표 납입 알림 서버
// action: key | sync | test | remove (앱에서 호출) / run (매시간 예약 작업, x-cron-secret 필요)
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKeys, sendPush } from "./webpush.ts";
import { daysBetween, iso, localNow, nextDue } from "./dates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return keys["default"];
}
const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false } });
const SUBJECT = SUPABASE_URL;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function getConfig(key: string) {
  const { data } = await db.from("fs_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function getVapid() {
  let v = await getConfig("vapid");
  if (!v) {
    const fresh = await generateVapidKeys();
    await db.from("fs_config").upsert({ key: "vapid", value: fresh }, { onConflict: "key", ignoreDuplicates: true });
    v = await getConfig("vapid");
  }
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
function cleanLoans(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((l) => ({
    id: str(l?.id, 64),
    name: str(l?.name, 60),
    amount: Number.isFinite(Number(l?.amount)) ? Math.max(0, Math.round(Number(l.amount))) : 0,
    day: Math.min(31, Math.max(1, Math.round(Number(l?.day)) || 0)),
    bank: str(l?.bank, 30),
    account: str(l?.account, 40),
  })).filter((l) => l.id && l.name && Number.isFinite(l.day) && l.day >= 1);
}
function cleanSub(s: any) {
  if (!s || typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://")) return null;
  if (!s.keys || typeof s.keys.p256dh !== "string" || typeof s.keys.auth !== "string") return null;
  return { endpoint: s.endpoint.slice(0, 1000), keys: { p256dh: s.keys.p256dh.slice(0, 200), auth: s.keys.auth.slice(0, 100) } };
}
function cleanTz(tz: unknown) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: String(tz) });
    return String(tz);
  } catch (_e) {
    return "Asia/Seoul";
  }
}

const won = (n: number) => n.toLocaleString("en-US") + "원";
function message(loan: any, diff: number, due: { y: number; m: number; d: number }) {
  const when = diff === 0 ? "오늘 납입" : diff === 1 ? "내일 납입" : diff + "일 뒤 납입";
  const acct = [loan.bank, loan.account].filter(Boolean).join(" ");
  return {
    title: when + " · " + loan.name,
    body: [won(loan.amount), acct].filter(Boolean).join("\n"),
    tag: "loan-" + loan.id + "-" + iso(due) + "-" + diff,
    loanId: loan.id,
    name: loan.name,
    amount: loan.amount,
    bank: loan.bank,
    account: loan.account,
    due: iso(due),
    diff,
  };
}

async function runAll() {
  const vapid = await getVapid();
  const { data: devices, error } = await db.from("fs_devices").select("*").eq("enabled", true).not("subscription", "is", null);
  if (error) throw error;
  let sent = 0, failed = 0;
  for (const dev of devices ?? []) {
    const today = localNow(dev.tz);
    if (today.hour < dev.notify_hour) continue;
    let gone = false;
    for (const loan of dev.loans ?? []) {
      if (gone) break;
      const due = nextDue(today, loan.day);
      const diff = daysBetween(today, due);
      if (!(dev.offsets ?? []).includes(diff)) continue;
      const row = { device_id: dev.device_id, loan_id: loan.id, due_date: iso(due), days_before: diff };
      const { data: ins } = await db.from("fs_sent").upsert(row, { onConflict: "device_id,loan_id,due_date,days_before", ignoreDuplicates: true }).select();
      if (!ins || ins.length === 0) continue; // 이미 보냄
      let status = 0;
      try {
        status = (await sendPush(dev.subscription, message(loan, diff, due), vapid, SUBJECT)).status;
      } catch (e) {
        console.error("push error", e);
      }
      if (status >= 200 && status < 300) {
        sent++;
      } else {
        failed++;
        await db.from("fs_sent").delete().match(row); // 다음 시간에 재시도
        if (status === 404 || status === 410) {
          await db.from("fs_devices").update({ subscription: null }).eq("device_id", dev.device_id);
          gone = true;
        }
      }
    }
  }
  await db.from("fs_sent").delete().lt("due_date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  await db.from("fs_config").upsert({ key: "last_run", value: { at: new Date().toISOString(), sent, failed }, updated_at: new Date().toISOString() });
  return { devices: devices?.length ?? 0, sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "bad json" }, 400);
  }
  try {
    const action = body?.action;
    if (action === "run") {
      const secret = await getConfig("cron_secret");
      if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
      return json({ ok: true, ...(await runAll()) });
    }
    if (action === "key") {
      const vapid = await getVapid();
      return json({ ok: true, publicKey: vapid.publicKey, lastRun: (await getConfig("last_run"))?.at ?? null });
    }
    const deviceId = String(body?.deviceId ?? "");
    if (!UUID.test(deviceId)) return json({ error: "bad deviceId" }, 400);

    if (action === "sync") {
      const s = body.settings ?? {};
      const offsets = Array.isArray(s.offsets)
        ? [...new Set(s.offsets.map((n: unknown) => Math.round(Number(n))).filter((n: number) => Number.isFinite(n) && n >= 0 && n <= 60))].slice(0, 10)
        : [7, 3, 1];
      const hour = Math.min(23, Math.max(0, Math.round(Number(s.hour)) || 0));
      const { error } = await db.from("fs_devices").upsert({
        device_id: deviceId,
        subscription: cleanSub(body.subscription),
        enabled: s.enabled !== false,
        offsets,
        notify_hour: hour,
        tz: cleanTz(s.tz),
        loans: cleanLoans(body.loans),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ ok: true, lastRun: (await getConfig("last_run"))?.at ?? null });
    }
    if (action === "test") {
      const { data: dev } = await db.from("fs_devices").select("subscription").eq("device_id", deviceId).maybeSingle();
      if (!dev?.subscription) return json({ error: "no subscription" }, 404);
      const vapid = await getVapid();
      const r = await sendPush(dev.subscription, {
        title: "테스트 알림 · 가족금융일정표",
        body: "알림이 정상적으로 도착했습니다.",
        tag: "test",
      }, vapid, SUBJECT);
      return json({ ok: r.status >= 200 && r.status < 300, status: r.status, detail: r.text });
    }
    if (action === "remove") {
      await db.from("fs_devices").delete().eq("device_id", deviceId);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
