
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await client.auth.getUser(token);
    if (authError || !auth.user) return new Response(JSON.stringify({ error: "Sign in to send a report." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const body = await req.json();
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("REPORT_FROM_EMAIL");
    if (body?.action === "status") return new Response(JSON.stringify({ configured: Boolean(resendKey && fromEmail) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!resendKey) return new Response(JSON.stringify({ error: "Email service is not configured yet." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!fromEmail) return new Response(JSON.stringify({ error: "Sender email is not configured yet." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "DriverTax Tax Summary").trim().slice(0, 180);
    const text = String(body?.text || "Please find the DriverTax report attached.").slice(0, 12000);
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return new Response(JSON.stringify({ error: "Enter a valid email address." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!attachments.length || attachments.length > 2) {
      return new Response(JSON.stringify({ error: "Attach a PDF, CSV, or both." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (attachments.some((a: any) => String(a?.content || "").length > 7000000)) {
      return new Response(JSON.stringify({ error: "Report attachment is too large." }), { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const safeAttachments = attachments.map((a: any) => ({
      filename: String(a?.filename || "report").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120),
      content: String(a?.content || ""),
    })).filter((a: any) => a.content.length > 0);

    if (safeAttachments.length !== attachments.length) {
      return new Response(JSON.stringify({ error: "One or more attachments were empty." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject,
        text,
        attachments: safeAttachments,
      }),
    });

    const result = await resendResponse.json().catch(() => ({}));
    if (!resendResponse.ok) {
      console.error("Resend error", result);
      return new Response(JSON.stringify({ error: result?.message || "Email provider rejected the message." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, id: result?.id || null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Email report error", err);
    return new Response(JSON.stringify({ error: "Could not send the report." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

