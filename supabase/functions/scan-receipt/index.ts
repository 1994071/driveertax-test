
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function cleanJsonText(text: string) {
  return text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  try {
    const scanStarted = Date.now();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "AI scanner is not activated yet", code: "OPENAI_KEY_MISSING" }), { status: 503, headers: cors });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });

    const body = await req.json();
    const includeItems = body?.mode !== "summary";
    const path = String(body?.path || "");
    const categories = Array.isArray(body?.categories)
      ? body.categories.map((x: unknown) => String(x)).filter(Boolean).slice(0, 30)
      : [];

    if (!path || !path.startsWith(user.id + "/")) {
      return new Response(JSON.stringify({ error: "Invalid receipt path" }), { status: 400, headers: cors });
    }

    if(path.split("/").some(part=>part===".."||part==="."))return new Response(JSON.stringify({error:"Invalid receipt path"}),{status:400,headers:cors});
    const quotaClient=createClient(supabaseUrl,serviceKey);
    const {data:allowed,error:quotaError}=await quotaClient.rpc("consume_api_request",{p_user_id:user.id,p_service:"receipt_scan"});
    if(quotaError)return new Response(JSON.stringify({error:"Scanning is temporarily unavailable. Please retry shortly."}),{status:503,headers:cors});
    if(!allowed)return new Response(JSON.stringify({error:"Too many scan requests. Please wait a minute and try again."}),{status:429,headers:{...cors,"Retry-After":"60"}});
    const downloadStarted = Date.now();
    let dataUrl: string;
    if (body?.image !== undefined) {
      // Direct image input never fetches caller URLs or accesses another user's storage.
      if (includeItems || typeof body.image !== "string" || body.image.length > 2800000) {
        return new Response(JSON.stringify({ error: "Invalid scan image" }), { status: 400, headers: cors });
      }
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image);
      if (!match || match[2].length % 4 !== 0) {
        return new Response(JSON.stringify({ error: "Invalid scan image" }), { status: 400, headers: cors });
      }
      const binary = atob(match[2]);
      if (!binary.length || binary.length > 2 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Scan image is too large" }), { status: 413, headers: cors });
      }
      const head = Array.from(binary.slice(0, 12), c => c.charCodeAt(0));
      const jpeg = head[0] === 255 && head[1] === 216 && head[2] === 255;
      const png = [137,80,78,71,13,10,26,10].every((v,i) => head[i] === v);
      const webp = binary.startsWith("RIFF") && binary.slice(8,12) === "WEBP";
      if (!(match[1] === "image/jpeg" ? jpeg : match[1] === "image/png" ? png : webp)) {
        return new Response(JSON.stringify({ error: "Invalid image contents" }), { status: 415, headers: cors });
      }
      dataUrl = body.image;
    } else {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data: blob, error: downloadError } = await admin.storage.from("receipts").download(path);
      if (downloadError || !blob) {
        return new Response(JSON.stringify({ error: "Could not read receipt image" }), { status: 404, headers: cors });
      }
      if (blob.size > 10 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Receipt image is too large" }), { status: 413, headers: cors });
      }
      const mime = blob.type;
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        return new Response(JSON.stringify({ error: "Choose a JPG, PNG or WebP receipt image.", code: "UNSUPPORTED_IMAGE" }), { status: 415, headers: cors });
      }
      if (!blob.size) {
        return new Response(JSON.stringify({ error: "Receipt image is empty.", code: "EMPTY_IMAGE" }), { status: 400, headers: cors });
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    }
    const downloadMs = Date.now() - downloadStarted;
    const categoryText = categories.length ? categories.join(", ") : "Fuel, Parking, Tolls, Vehicle Repairs, Vehicle Cleaning, Phone, Insurance, Licensing, Other";

    const itemInstructions = includeItems
      ? 'items: array of up to 60 readable purchase lines, each with description (string), amount (final line total including VAT after line discounts, number), category (from the category list). Use [] when item lines cannot be read reliably. Do not treat a subtotal, receipt total or payment as a product. Do not invent amounts to balance the receipt. Keep unallocated discounts visible by leaving item totals unreconciled for the user to check.'
      : 'items: []. Read the merchant, receipt date and final totals only. Do not transcribe individual products.';
    const prompt = `Read this UK business receipt carefully. Return ONLY a compact JSON object with:
merchant: string or "",
date: YYYY-MM-DD or "",
amount: receipt grand total as a number or null,
vat: VAT amount explicitly shown on the receipt as a number or null,
category: choose the best single category from this exact list: ${categoryText},
confidence: number from 0 to 1,
${itemInstructions}

Rules:
- Use the final amount actually paid / grand total, not a subtotal.
- Never invent VAT. If VAT is not explicitly shown, use null.
- Never invent unreadable values.
- For ambiguous numeric dates, use UK day/month/year convention.
- Do not include markdown or commentary.`;

    const aiStarted = Date.now();
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-6-luna",
        reasoning: { effort: "low" },
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: dataUrl, detail: "high" }
          ]
        }],
        max_output_tokens: includeItems ? 2400 : 1000
      }),
    });

    const raw = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error("OpenAI error", raw?.error?.message || raw);
      return new Response(JSON.stringify({ error: "AI could not read this receipt. You can still enter it manually.", code: "AI_ERROR" }), { status: 502, headers: cors });
    }

    const outputText =
      raw?.output_text ||
      raw?.output?.flatMap((item: any) => item?.content || []).find((part: any) => part?.type === "output_text")?.text ||
      "";

    let parsed: any;
    try {
      parsed = JSON.parse(cleanJsonText(outputText));
    } catch {
      console.error("Could not parse receipt model output");
      return new Response(JSON.stringify({ error: "AI result needs manual entry", code: "PARSE_ERROR" }), { status: 422, headers: cors });
    }

    const result = {
      merchant: typeof parsed.merchant === "string" ? parsed.merchant.trim().slice(0, 120) : "",
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.date || "")) ? String(parsed.date) : "",
      amount: parsed.amount === null || parsed.amount === "" || parsed.amount === undefined ? null : (Number.isFinite(Number(parsed.amount)) && Number(parsed.amount) >= 0 ? Number(parsed.amount) : null),
      vat: parsed.vat === null || parsed.vat === "" || parsed.vat === undefined ? null : (Number.isFinite(Number(parsed.vat)) && Number(parsed.vat) >= 0 ? Number(parsed.vat) : null),
      category: categories.includes(String(parsed.category)) ? String(parsed.category) : (categories.includes("Other") ? "Other" : String(parsed.category || "Other")),
      items: includeItems && Array.isArray(parsed.items) ? parsed.items.slice(0,60).filter((i: any) => typeof i?.description === "string" && typeof i?.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 && i.amount < 1000000000).map((i: any) => ({description:i.description.trim().slice(0,200), amount:Math.round(i.amount*100)/100, category:categories.includes(i.category)?i.category:"Other"})) : [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    };

    const timings = { download_ms: downloadMs, ai_ms: Date.now() - aiStarted, total_ms: Date.now() - scanStarted };
    console.info("Receipt scan timing", JSON.stringify(timings));
    return new Response(JSON.stringify({ data: result, timings }), { status: 200, headers: cors });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Receipt scan failed. You can still enter the receipt manually." }), { status: 500, headers: cors });
  }
});


