const SB_URL = "https://nkueqotdlhaxjrmpieiq.supabase.co";
const PUB = "sb_publishable_NTh0VU_QwlgMUMOFGQKKiQ_gyPyZIrk";
const AMOUNT = 400000;
const DAYS = 30;
const json = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false });
  try {
    const body = JSON.parse(event.body || "{}");
    const reference = body.reference;
    const token = body.token;
    if (!reference || !token) return json(400, { ok: false, error: "missing details" });
    const SECRET = process.env.SB_SECRET_KEY;
    const PSK = process.env.PAYSTACK_SECRET_KEY;
    if (!SECRET || !PSK) return json(500, { ok: false, error: "server not configured" });

    const ur = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: PUB, Authorization: "Bearer " + token } });
    if (!ur.ok) return json(401, { ok: false, error: "not logged in" });
    const user = await ur.json();

    const pr = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference), { headers: { Authorization: "Bearer " + PSK } });
    const pj = await pr.json();
    const d = pj.data;
    if (!pj.status || !d || d.status !== "success" || d.currency !== "NGN" || d.amount < AMOUNT) return json(402, { ok: false, error: "payment not successful" });
    if (!d.metadata || d.metadata.user_id !== user.id) return json(403, { ok: false, error: "payment does not match this account" });

    const H = { apikey: SECRET, "Content-Type": "application/json" };
    const ins = await fetch(SB_URL + "/rest/v1/payments", { method: "POST", headers: Object.assign({ Prefer: "return=minimal" }, H), body: JSON.stringify({ reference: reference, user_id: user.id, amount: d.amount }) });
    if (ins.status === 409) return json(200, { ok: true, already: true });
    if (!ins.ok) return json(500, { ok: false, error: "could not record payment" });

    const gr = await fetch(SB_URL + "/rest/v1/profiles?id=eq." + user.id + "&select=premium_until", { headers: H });
    const rows = gr.ok ? await gr.json() : [];
    let base = Date.now();
    if (rows[0] && rows[0].premium_until) base = Math.max(base, new Date(rows[0].premium_until).getTime());
    const until = new Date(base + DAYS * 86400000).toISOString();

    const up = await fetch(SB_URL + "/rest/v1/profiles?id=eq." + user.id, { method: "PATCH", headers: Object.assign({ Prefer: "return=minimal" }, H), body: JSON.stringify({ premium: true, premium_until: until }) });
    if (!up.ok) {
      await fetch(SB_URL + "/rest/v1/payments?reference=eq." + encodeURIComponent(reference), { method: "DELETE", headers: H });
      return json(500, { ok: false, error: "could not unlock premium" });
    }
    return json(200, { ok: true, premium_until: until });
  } catch (e) {
    return json(500, { ok: false, error: "server error" });
  }
};
