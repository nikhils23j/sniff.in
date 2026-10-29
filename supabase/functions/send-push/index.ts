// Durable worker: pg_net/cron invoke this endpoint; jobs survive timeouts and crashes.
// Expo tickets mean provider acceptance. Receipts are checked separately after 15 minutes.
import { fail, json, log, serviceClient } from '../_shared/http.ts';

type Job = { notification_id: string; lease_id: string; generation: number; attempt: number };
type Device = { token_id: string; token: string };
type Notice = { id: string; user_id: string; type: string; title: string; body: string | null;
  conversation_id: string | null; server_id: string | null; request_id: string | null; post_id: string | null;
  created_at: string; read_at: string | null };
type Outcome = { token_id: string; status: 'accepted' | 'retry' | 'invalid' | 'failed'; ticket_id?: string; error?: string };
type Ticket = { status: 'ok' | 'error'; id?: string; details?: { error?: string } };
type Receipt = { status: 'ok' | 'error'; details?: { error?: string } };
type ReceiptClaim = { delivery_id: string; ticket_id: string };

const GENERIC: Record<string, string> = {
  connection_request: 'You have a new connection request', request_accepted: 'Your request was accepted',
  message: 'You have a new message', server_membership: 'Server update',
  server_announcement: 'New announcement in a Server', activity_response: 'Someone responded to your activity',
  badge_granted: 'You received a Server badge', endorsement: 'You received an endorsement',
  connection_saved: 'A connection wants to stay in touch', ephemeral_expiring: 'A chat disappears soon',
  moderation: 'Update about your content',
};
const PREF: Record<string, string> = {
  connection_request: 'notify_requests', request_accepted: 'notify_requests', message: 'notify_messages',
  activity_response: 'notify_activity', server_membership: 'notify_servers', badge_granted: 'notify_servers',
  server_announcement: 'notify_announcements',
};
const headers: Record<string, string> = {
  'Content-Type': 'application/json', Accept: 'application/json',
  ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {}),
};

async function sendJob(admin: ReturnType<typeof serviceClient>, job: Job) {
  const { data: n, error: noticeError } = await admin.from('notifications')
    .select('id,user_id,type,title,body,conversation_id,server_id,request_id,post_id,created_at,read_at')
    .eq('id', job.notification_id).maybeSingle();
  if (noticeError) throw noticeError;
  const notice = n as Notice | null;
  if (!notice || notice.read_at) {
    await admin.rpc('finish_push_job', { p_notification_id: job.notification_id, p_lease_id: job.lease_id, p_outcomes: [] });
    return;
  }
  // A read chat should never create a stale lock-screen alert.
  if (notice.type === 'message' && notice.conversation_id) {
    const { data: read } = await admin.from('conversation_participants').select('last_read_at')
      .eq('conversation_id', notice.conversation_id).eq('user_id', notice.user_id).maybeSingle();
    if (read?.last_read_at && read.last_read_at >= notice.created_at) {
      await admin.rpc('finish_push_job', { p_notification_id: job.notification_id, p_lease_id: job.lease_id, p_outcomes: [] });
      return;
    }
  }
  const [{ data: settings, error: settingsError }, { data: pending, error: devicesError }] = await Promise.all([
    admin.from('user_settings').select('push_previews,notify_requests,notify_messages,notify_activity,notify_servers,notify_announcements')
      .eq('user_id', notice.user_id).single(),
    admin.rpc('pending_push_devices', { p_notification_id: job.notification_id, p_lease_id: job.lease_id }),
  ]);
  if (settingsError || devicesError) throw settingsError ?? devicesError;
  const pref = PREF[notice.type];
  if ((pref && settings?.[pref as keyof typeof settings] === false) || !(pending as Device[] | null)?.length) {
    await admin.rpc('finish_push_job', { p_notification_id: job.notification_id, p_lease_id: job.lease_id, p_outcomes: [] });
    return;
  }
  const devices = (pending as Device[]).slice(0, 100);
  const { count: unread } = await admin.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', notice.user_id).is('read_at', null);
  const messages = devices.map((device) => ({
    to: device.token, title: settings?.push_previews ? notice.title : (GENERIC[notice.type] ?? 'Sniff.in'),
    body: settings?.push_previews && notice.type !== 'message' ? (notice.body ?? undefined) : undefined,
    sound: 'default', badge: Math.min(unread ?? 1, 99),
    data: { type: notice.type, notification_id: notice.id, conversation_id: notice.conversation_id,
      server_id: notice.server_id, request_id: notice.request_id, post_id: notice.post_id },
    channelId: notice.type === 'message' ? 'messages' : 'default',
    priority: notice.type === 'message' || notice.type === 'connection_request' ? 'high' : 'default',
    ...(notice.conversation_id ? { collapseId: `conv-${notice.conversation_id}`, threadId: `conv-${notice.conversation_id}` } : {}),
  }));
  let outcomes: Outcome[];
  let transportError: string | null = null;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.json() as { data?: Ticket[] | Ticket };
    const tickets = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];
    if (tickets.length !== devices.length) throw new Error('ticket_count_mismatch');
    outcomes = tickets.map((ticket, i) => {
      const code = ticket.details?.error;
      return ticket.status === 'ok' && ticket.id
        ? { token_id: devices[i].token_id, status: 'accepted', ticket_id: ticket.id }
        : { token_id: devices[i].token_id,
          status: code === 'DeviceNotRegistered' ? 'invalid' : code === 'MessageRateExceeded' ? 'retry' : 'failed',
          error: code ?? 'ticket_error' };
    });
  } catch (error) {
    transportError = String((error as Error)?.message ?? 'transport_error').slice(0, 100);
    outcomes = devices.map((device) => ({ token_id: device.token_id, status: 'retry', error: transportError! }));
  }
  const invalid = outcomes.filter((o) => o.status === 'invalid').map((o) => o.token_id);
  if (invalid.length) await admin.from('push_tokens').delete().in('id', invalid);
  const { error: finishError } = await admin.rpc('finish_push_job', {
    p_notification_id: job.notification_id, p_lease_id: job.lease_id, p_outcomes: outcomes, p_error: transportError,
  });
  if (finishError) throw finishError;
  log('push_attempt', { accepted: outcomes.filter((o) => o.status === 'accepted').length,
    retry: outcomes.filter((o) => o.status === 'retry').length, invalid: invalid.length, attempt: job.attempt });
}

async function checkReceipts(admin: ReturnType<typeof serviceClient>) {
  const { data, error } = await admin.rpc('claim_push_receipts', { p_limit: 100 });
  if (error) throw error;
  const claims = (data ?? []) as ReceiptClaim[];
  if (!claims.length) return 0;
  const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
    method: 'POST', headers, body: JSON.stringify({ ids: claims.map((c) => c.ticket_id) }), signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`receipt_http_${res.status}`);
  const body = await res.json() as { data?: Record<string, Receipt> };
  for (const claim of claims) {
    const receipt = body.data?.[claim.ticket_id];
    const { error: saveError } = await admin.rpc('finish_push_receipt', {
      p_delivery_id: claim.delivery_id, p_status: !receipt ? 'missing' : receipt.status,
      p_error: receipt?.details?.error ?? null,
    });
    if (saveError) throw saveError;
  }
  return claims.length;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return fail('forbidden', 403);
  const admin = serviceClient();
  try {
    const { data, error } = await admin.rpc('claim_push_jobs', { p_limit: 20 });
    if (error) throw error;
    const jobs = (data ?? []) as Job[];
    for (const job of jobs) {
      try { await sendJob(admin, job); }
      catch (error) {
        log('push_job_error', { kind: String((error as Error)?.message ?? 'unknown').slice(0, 80) });
        await admin.rpc('finish_push_job', { p_notification_id: job.notification_id, p_lease_id: job.lease_id,
          p_outcomes: [], p_error: 'worker_error' });
      }
    }
    let receipts = 0;
    try { receipts = await checkReceipts(admin); }
    catch (error) { log('push_receipt_error', { kind: String((error as Error)?.message ?? 'unknown').slice(0, 80) }); }
    return json({ jobs: jobs.length, receipts });
  } catch (error) {
    log('push_worker_error', { kind: String((error as Error)?.message ?? 'unknown').slice(0, 80) });
    return json({ error: 'worker_failed' }, 503);
  }
});
