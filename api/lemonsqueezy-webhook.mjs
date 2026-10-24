// DRAFT (not in the repo): Lemon Squeezy order webhook -> Meta Conversions API Purchase event.
// Would live at api/lemonsqueezy-webhook.mjs in the Vercel project.
// Env vars required (set in Vercel, never committed):
//   LEMONSQUEEZY_WEBHOOK_SECRET  signing secret chosen when creating the webhook in Lemon Squeezy
//   META_CAPI_ACCESS_TOKEN       token from Events Manager > Settings > Conversions API
//   META_TEST_EVENT_CODE         optional; when set, events go to Test events instead of live data
import crypto from 'node:crypto';

const PIXEL_ID = '1593096642062741';
const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

export async function POST(request) {
  const raw = await request.text();
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const sig = request.headers.get('x-signature') || '';
  const expected = crypto.createHmac('sha256', secret || '').update(raw).digest('hex');
  const ok = secret && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return new Response('invalid signature', { status: 401 });

  const payload = JSON.parse(raw);
  if (payload?.meta?.event_name !== 'order_created') return new Response('ignored', { status: 200 });

  const order = payload.data;
  const a = order.attributes;
  // Test-mode orders only go to Meta when a test event code is configured.
  const testCode = process.env.META_TEST_EVENT_CODE;
  if (a.test_mode && !testCode) return new Response('test order skipped', { status: 200 });

  const body = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(new Date(a.created_at).getTime() / 1000),
      event_id: `ls_order_${order.id}`, // matches the browser Purchase eventID so Meta de-duplicates
      action_source: 'website',
      event_source_url: 'https://quietleverages.com/',
      user_data: a.user_email ? { em: [sha256(a.user_email)] } : {},
      custom_data: {
        value: a.total / 100,
        currency: a.currency || 'USD',
        content_name: 'The Finance Architect',
        content_ids: ['finance-architect'],
        content_type: 'product',
        num_items: 1,
      },
    }],
    ...(testCode ? { test_event_code: testCode } : {}),
  };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(process.env.META_CAPI_ACCESS_TOKEN)}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  return new Response(await res.text(), { status: res.ok ? 200 : 502 });
}
