import nodemailer from 'npm:nodemailer@6.9.16';
import { Buffer } from 'node:buffer';

import { corsHeaders, env, fail, json, log, requireUser, serviceClient } from '../_shared/http.ts';

type FeedbackPayload = { id: string; user_id: string; category: string; body: string;
  emailed_at: string | null; paths: string[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method_not_allowed', 405);
  const user = await requireUser(req);
  if (!user) return fail('not_authenticated', 401);
  const input = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.client_id !== 'string' || typeof input.body !== 'string'
    || typeof input.category !== 'string' || !Array.isArray(input.paths)
    || input.paths.some((path) => typeof path !== 'string')) return fail('invalid_feedback');

  const { data: feedbackId, error: submitError } = await user.client.rpc('submit_feedback_v33', {
    p_client_id: input.client_id, p_category: input.category, p_body: input.body, p_paths: input.paths,
  });
  if (submitError || !feedbackId) {
    log('feedback_rejected', { code: submitError?.code ?? 'unknown' });
    return fail('invalid_feedback');
  }

  const admin = serviceClient();
  const { data, error: lookupError } = await admin.rpc('feedback_email_payload', { p_id: feedbackId });
  const feedback = data as FeedbackPayload | null;
  if (lookupError || !feedback || feedback.user_id !== user.id) return fail('feedback_unavailable', 500);
  if (feedback.emailed_at) return json({ sent: true, id: feedback.id });

  try {
    const attachments = [];
    for (let i = 0; i < feedback.paths.length; i++) {
      const path = feedback.paths[i];
      const { data: file, error } = await admin.storage.from('feedback-media').download(path);
      if (error || !file) throw new Error('attachment_download_failed');
      attachments.push({ filename: `attachment-${i + 1}.jpg`, content: Buffer.from(await file.arrayBuffer()), contentType: 'image/jpeg' });
    }
    const smtpUser = env('SMTP_USER');
    const port = Number(Deno.env.get('SMTP_PORT') || 465);
    const transporter = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com', port, secure: port === 465,
      auth: { user: smtpUser, pass: env('SMTP_PASS') },
    });
    await transporter.sendMail({
      from: `"Sniff.in Feedback" <${Deno.env.get('SMTP_FROM') || smtpUser}>`,
      to: env('FEEDBACK_TO'),
      subject: `[Sniff.in feedback] ${feedback.category}`,
      text: `Category: ${feedback.category}\nUser ID: ${feedback.user_id}\nFeedback ID: ${feedback.id}\n\n${feedback.body}`,
      attachments,
    });
    const { error: markError } = await admin.rpc('mark_feedback_emailed', { p_id: feedback.id });
    if (markError) throw markError;
    log('feedback_emailed', { id: feedback.id, attachments: attachments.length });
    return json({ sent: true, id: feedback.id });
  } catch (error) {
    log('feedback_email_failed', { id: feedback.id, code: String((error as Error)?.message ?? 'unknown').slice(0, 80) });
    return fail('email_send_failed', 502);
  }
});
