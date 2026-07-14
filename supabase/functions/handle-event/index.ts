// supabase/functions/handle-event/index.ts
// m-way app — Push notification dispatcher
// Receives Database Webhook payloads from Supabase, decides what to send, and pushes to Web Push subscribers.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config ─────────────────────────────────────────────
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Majd's user identifier (matches what the app saves when she enables notifications).
// The director-side NotificationsSection saves user_id = sb.getUserEmail() which is her login email.
const DIRECTOR_USER_ID = "themajdabdullah@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

// ── Helpers ────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " ر.س";

async function getMemberName(memberId: string): Promise<string> {
  if (!memberId) return "مساعد";
  const { data } = await supabase.from("team_members").select("display_name").eq("id", memberId).single();
  return (data?.display_name) || "مساعد";
}
async function getProjectName(projectId: string): Promise<string> {
  if (!projectId) return "المشروع";
  const { data } = await supabase.from("projects").select("name").eq("id", projectId).single();
  return (data?.name) || "المشروع";
}

/** Send a push notification to every enabled subscription for a given user_id. */
async function sendToUser(userId: string, notif: { title: string; body: string; data?: any; tag?: string }) {
  if (!userId) return;
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) { console.error("[sendToUser] fetch error:", error.message); return; }
  if (!subs || subs.length === 0) { console.log("[sendToUser] no subscriptions for", userId); return; }

  const payload = JSON.stringify(notif);
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
        payload
      );
      await supabase.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
      console.log(`[push ✓] ${s.device_label} (${userId})`);
    } catch (err: any) {
      console.error(`[push ✗] ${s.device_label}:`, err.statusCode, err.body || err.message);
      // 410 Gone / 404 Not Found → endpoint is dead, mark this subscription disabled
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from("push_subscriptions").update({ enabled: false }).eq("id", s.id);
      }
    }
  }));
}

// ── Event Handlers ─────────────────────────────────────

// EXPENSES INSERT — fires multiple director-facing events
async function onExpenseInsert(rec: any) {
  // Only fire for member-added expenses (not director's own)
  if (rec.added_by === "director" || !rec.member_id) return;

  const memberName  = await getMemberName(rec.member_id);
  const projectName = await getProjectName(rec.project_id);
  const amount      = Number(rec.amount) || 0;

  // Event 1: New purchase (always)
  await sendToUser(DIRECTOR_USER_ID, {
    title: "🛒 مشترى جديد",
    body: `${memberName} أضاف "${rec.name}" بقيمة ${fmt(amount)} في "${projectName}"`,
    tag: `expense-new-${rec.id}`,
    data: { type: "expense_new", project_id: rec.project_id, expense_id: rec.id },
  });

  // Event 4: High-value expense (> 1,000 SAR)
  if (amount > 1000) {
    await sendToUser(DIRECTOR_USER_ID, {
      title: "⚠️ مشترى بقيمة عالية",
      body: `${memberName} أضاف مشترى بقيمة ${fmt(amount)} — "${rec.name}"`,
      tag: `expense-highvalue-${rec.id}`,
      data: { type: "expense_highvalue", project_id: rec.project_id, expense_id: rec.id },
    });
  }

  // Event 3: Custody threshold crossings (50% / 80% / 100%)
  await checkCustodyThresholds(rec.member_id, rec.project_id, memberName, projectName);
}

// EXPENSES UPDATE — only "marked paid" event for now
async function onExpenseUpdate(rec: any, old: any) {
  if (!old.paid && rec.paid && rec.added_by !== "director" && rec.member_id) {
    const projectName = await getProjectName(rec.project_id);
    await sendToUser(rec.member_id, {
      title: "✅ تم تسجيل دفعتك",
      body: `سُجّل دفع "${rec.name}" بقيمة ${fmt(Number(rec.amount) || 0)} في "${projectName}"`,
      tag: `expense-paid-${rec.id}`,
      data: { type: "expense_paid", project_id: rec.project_id, expense_id: rec.id },
    });
  }
}

// CUSTODY_REQUESTS INSERT — fire to director
async function onCustodyRequestInsert(rec: any) {
  const name = rec.member_name || (rec.member_id ? await getMemberName(rec.member_id) : "مساعد");
  await sendToUser(DIRECTOR_USER_ID, {
    title: "💰 طلب عهدة جديد",
    body: `${name} يطلب ${fmt(Number(rec.amount) || 0)} — السبب: ${rec.reason || "لم يُذكر"}`,
    tag: `custody-req-${rec.id}`,
    data: { type: "custody_request_new", request_id: rec.id, project_id: rec.project_id },
  });
}

// CUSTODY_REQUESTS UPDATE — director approved/rejected → notify member
async function onCustodyRequestUpdate(rec: any, old: any) {
  if (old.status === rec.status) return;
  const amount = fmt(Number(rec.amount) || 0);
  if (rec.status === "approved") {
    await sendToUser(rec.member_id || "", {
      title: "✅ تمت الموافقة على طلب عهدتك",
      body: `وافقت مجد على طلبك بـ ${amount} — استلم العهدة في أقرب وقت 💰`,
      tag: `custody-resp-${rec.id}`,
      data: { type: "custody_request_approved", request_id: rec.id },
    });
  } else if (rec.status === "rejected") {
    await sendToUser(rec.member_id || "", {
      title: "❌ تم رفض طلب العهدة",
      body: `لم توافق مجد على طلبك بـ ${amount} — تواصل معها للمزيد`,
      tag: `custody-resp-${rec.id}`,
      data: { type: "custody_request_rejected", request_id: rec.id },
    });
  }
}

// TEAM_MEMBERS INSERT — welcome new member to project
async function onTeamMemberInsert(rec: any) {
  if (!rec.project_id) return;
  const projectName = await getProjectName(rec.project_id);
  await sendToUser(rec.id, {
    title: "👋 تمت إضافتك لمشروع جديد",
    body: `أضافتك مجد لمشروع "${projectName}" — افتح التطبيق للتفاصيل`,
    tag: `member-added-${rec.id}`,
    data: { type: "team_member_added", project_id: rec.project_id },
  });
}

// TEAM_MEMBERS UPDATE — custody increased or decreased
async function onTeamMemberUpdate(rec: any, old: any) {
  const oldC = Number(old.custody) || 0;
  const newC = Number(rec.custody) || 0;
  if (oldC === newC) return;
  const diff = Math.abs(newC - oldC);
  const projectName = rec.project_id ? await getProjectName(rec.project_id) : "";
  const totalLabel  = fmt(newC);
  if (newC > oldC) {
    await sendToUser(rec.id, {
      title: "💰 تمت زيادة عهدتك",
      body: `زادت مجد عهدتك بـ ${fmt(diff)} في "${projectName}" — الإجمالي الآن: ${totalLabel}`,
      tag: `custody-change-${rec.id}-${Date.now()}`,
      data: { type: "custody_increased", project_id: rec.project_id },
    });
  } else {
    await sendToUser(rec.id, {
      title: "💸 تم تخفيض عهدتك",
      body: `خفضت مجد عهدتك بـ ${fmt(diff)} في "${projectName}" — الإجمالي الآن: ${totalLabel}`,
      tag: `custody-change-${rec.id}-${Date.now()}`,
      data: { type: "custody_reduced", project_id: rec.project_id },
    });
  }
}

// CUSTODY_TRANSFERS INSERT — between members → notify director
async function onCustodyTransferInsert(rec: any) {
  const projectName = rec.project_id ? await getProjectName(rec.project_id) : "";
  const fromName    = await getMemberName(rec.from_member);
  const toName      = await getMemberName(rec.to_member);
  const amount      = fmt(Number(rec.amount) || 0);
  await sendToUser(DIRECTOR_USER_ID, {
    title: "🔄 تحويل عهدة بين الفريق",
    body: `${fromName} حوّل ${amount} لـ ${toName} في "${projectName}"`,
    tag: `transfer-${rec.id}`,
    data: { type: "custody_transfer", project_id: rec.project_id },
  });
}

// APP_MESSAGE INSERT — Faris updated the app message
async function onAppMessageInsert(_rec: any) {
  await sendToUser(DIRECTOR_USER_ID, {
    title: "✉️ رسالة جديدة من فارس",
    body: `تم تحديث رسالة التطبيق — افتحي "عن التطبيق" لقراءتها 💌`,
    tag: `app-message`,
    data: { type: "app_message_update" },
  });
}

// ── Custody threshold detector ─────────────────────────
async function checkCustodyThresholds(memberId: string, projectId: string, memberName: string, projectName: string) {
  // Fetch member's custody for this project
  const { data: mem } = await supabase
    .from("team_members")
    .select("custody")
    .eq("id", memberId)
    .single();
  const custody = Number(mem?.custody) || 0;
  if (custody <= 0) return;

  // Sum all paid (non-returned) expenses by this member in this project
  const { data: exps } = await supabase
    .from("expenses")
    .select("amount, created_at")
    .eq("project_id", projectId)
    .eq("member_id", memberId)
    .eq("paid", true)
    .eq("returned", false)
    .order("created_at", { ascending: true });
  if (!exps || exps.length === 0) return;

  // We need the threshold state BEFORE the latest expense vs AFTER.
  // The triggering expense is the last one. Total after = sum of all; total before = total - last.
  const totalAfter  = exps.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);
  const lastAmount  = Number(exps[exps.length - 1].amount) || 0;
  const totalBefore = totalAfter - lastAmount;

  const pctBefore = totalBefore / custody;
  const pctAfter  = totalAfter  / custody;
  const remaining = Math.max(0, custody - totalAfter);

  // 50% crossing → director only
  if (pctBefore < 0.5 && pctAfter >= 0.5) {
    await sendToUser(DIRECTOR_USER_ID, {
      title: "⚠️ نصف العهدة استُهلك",
      body: `${memberName} استهلك ٥٠٪ من عهدته في "${projectName}" — متبقي ${fmt(remaining)}`,
      tag: `custody-50-${memberId}-${projectId}`,
      data: { type: "custody_50", project_id: projectId, member_id: memberId },
    });
  }

  // 80% crossing → both director and member
  if (pctBefore < 0.8 && pctAfter >= 0.8) {
    await sendToUser(DIRECTOR_USER_ID, {
      title: "⚠️ تنبيه: ٨٠٪ من العهدة",
      body: `${memberName} اقترب من نفاذ عهدته — متبقي ${fmt(remaining)} فقط`,
      tag: `custody-80-${memberId}-${projectId}`,
      data: { type: "custody_80", project_id: projectId, member_id: memberId },
    });
    await sendToUser(memberId, {
      title: "⚠️ عهدتك اقتربت من النفاد",
      body: `استُهلك ٨٠٪ من عهدتك في "${projectName}" — متبقي ${fmt(remaining)} فقط`,
      tag: `custody-80-self-${memberId}`,
      data: { type: "custody_80_self", project_id: projectId },
    });
  }

  // 100% crossing → both director and member
  if (pctBefore < 1.0 && pctAfter >= 1.0) {
    await sendToUser(DIRECTOR_USER_ID, {
      title: "🚨 العهدة استُنفدت بالكامل",
      body: `${memberName} استنفد كامل عهدته في "${projectName}" — قد يحتاج عهدة إضافية`,
      tag: `custody-100-${memberId}-${projectId}`,
      data: { type: "custody_100", project_id: projectId, member_id: memberId },
    });
    await sendToUser(memberId, {
      title: "🚨 عهدتك استُنفدت",
      body: `استُهلك كامل عهدتك في "${projectName}" — اطلب زيادة إذا احتجت`,
      tag: `custody-100-self-${memberId}`,
      data: { type: "custody_100_self", project_id: projectId },
    });
  }
}

// ── Main Handler ───────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight (Supabase webhooks shouldn't need this, but just in case)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  try {
    const body = await req.json();
    // Database Webhook payload shape:
    // { type: "INSERT"|"UPDATE"|"DELETE", table: "...", record: {...}, old_record: {...}, schema: "public" }
    const { type, table, record, old_record } = body;

    console.log(`[event] ${type} on ${table}`);

    if (table === "expenses") {
      if (type === "INSERT") await onExpenseInsert(record);
      else if (type === "UPDATE") await onExpenseUpdate(record, old_record);
    } else if (table === "custody_requests") {
      if (type === "INSERT") await onCustodyRequestInsert(record);
      else if (type === "UPDATE") await onCustodyRequestUpdate(record, old_record);
    } else if (table === "team_members") {
      if (type === "INSERT") await onTeamMemberInsert(record);
      else if (type === "UPDATE") await onTeamMemberUpdate(record, old_record);
    } else if (table === "custody_transfers") {
      if (type === "INSERT") await onCustodyTransferInsert(record);
    } else if (table === "app_message") {
      if (type === "INSERT") await onAppMessageInsert(record);
    } else {
      console.log(`[event] unhandled table: ${table}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[handle-event] error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
