import { z } from 'zod';

/** Client-side validation mirroring DB CHECK constraints. The DB remains the authority. */

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const otpSchema = z.string().trim().regex(/^\d{6,8}$/, 'Enter the code from your email');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, '3–20 characters: letters, numbers and underscores');

export const displayNameSchema = z.string().trim().min(1, 'Please enter your name').max(60, 'Keep it under 60 characters');

/** Returns the user's age in whole years at `today`. */
export function ageOn(dob: Date, today = new Date()): number {
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00`).getTime()), 'Enter a valid date')
  .refine((s) => ageOn(new Date(`${s}T00:00:00`)) >= 18, 'Sniff.in is only for adults aged 18 and over')
  .refine((s) => ageOn(new Date(`${s}T00:00:00`)) <= 110, 'Enter a valid date of birth');

const optionalText = (max: number) =>
  z.string().trim().max(max, `Keep it under ${max} characters`).optional().or(z.literal(''));

const optionalUrl = (re: RegExp, msg: string) =>
  z.string().trim().max(200).refine((v) => v === '' || re.test(v), msg).optional().or(z.literal(''));

export const profileSchema = z.object({
  display_name: displayNameSchema,
  bio: optionalText(300),
  social_preferences: optionalText(300),
  professional_bio: optionalText(500),
  work_experience: optionalText(400),
  professional_interests: optionalText(300),
  university: optionalText(100),
  occupation: optionalText(100),
  career_goals: optionalText(300),
  website_url: optionalUrl(/^https:\/\/\S+$/, 'Use a full https:// link'),
  instagram_handle: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, ''))
    .refine((v) => v === '' || /^[A-Za-z0-9._]{1,30}$/.test(v), 'Just the handle, e.g. sniff.in')
    .optional()
    .or(z.literal('')),
  linkedin_url: optionalUrl(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/\S+$/, 'Paste your linkedin.com profile link'),
  height_cm: z.string().trim().refine((v) => v === '' || (/^\d{2,3}$/.test(v) && Number(v) >= 90 && Number(v) <= 250), 'Use 90–250 cm').optional(),
  education_level: optionalText(30),
  school_name: optionalText(120),
  workplace: optionalText(120),
  job_title: optionalText(100),
  hometown: optionalText(100),
  relationship_status: optionalText(30),
});
export type ProfileForm = z.infer<typeof profileSchema>;

export const cravingSchema = z.object({
  body: z.string().trim().min(3, 'Say a little more').max(140, 'Keep it under 140 characters'),
  hours: z.number().int().min(1).max(168),
  serverId: z.string().uuid().nullable(),
});

export const postSchema = z.object({
  body: z.string().trim().min(3, 'Say a little more').max(500, 'Keep it under 500 characters'),
  category: z.enum(['social', 'sports', 'travel', 'professional', 'study', 'food', 'other']),
  serverId: z.string().uuid({ message: 'Choose a Server' }),
  expiresHours: z.number().int().min(1).max(720).nullable(),
});

export const serverSchema = z
  .object({
    name: z.string().trim().min(2, 'At least 2 characters').max(80),
    description: optionalText(500),
    kind: z.enum(['long_term', 'short_term', 'global']),
    category: z.string(),
    joinPolicy: z.enum(['invite_only', 'approval', 'open']),
    visibility: z.enum(['listed', 'unlisted']),
    endsAt: z.date().nullable(),
    ephemeralChats: z.boolean(),
    city: optionalText(60),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'short_term') {
      if (!v.endsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Short-term Servers need an end time' });
      else if (v.endsAt.getTime() <= Date.now()) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End time must be in the future' });
      else if (v.endsAt.getTime() - Date.now() > 60 * 24 * 3600_000)
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Choose a start within 30 days and a duration of at most 30 days' });
    }
    if (v.ephemeralChats && v.kind !== 'short_term')
      ctx.addIssue({ code: 'custom', path: ['ephemeralChats'], message: 'Only short-term Servers can have disappearing chats' });
    if (v.joinPolicy === 'open' && v.kind !== 'global')
      ctx.addIssue({ code: 'custom', path: ['joinPolicy'], message: 'Open joining is only for global Servers' });
  });

export const messageSchema = z.string().trim().min(1).max(2000, 'Messages are limited to 2000 characters');

export const tagNameSchema = z.string().trim().min(1).max(40, 'Keep tags under 40 characters');

/** Extracts a join token from a scanned QR / pasted link / typed code. Mirrors app_private.normalize_token. */
export function extractJoinToken(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const q = s.match(/[?&]t=([A-Za-z0-9_=-]+)/);
  if (q) return q[1];
  const p = s.match(/\/join\/([A-Za-z0-9_=-]+)/);
  if (p) return p[1];
  if (/^[A-Za-z0-9]{8}$/.test(s)) return s.toUpperCase();
  if (/^[A-Za-z0-9_=-]{16,64}$/.test(s)) return s;
  return null;
}
