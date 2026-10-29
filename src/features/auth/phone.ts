/** Supabase expects an E.164 number. Keep the country code explicit so no local-number guess is made. */
export function e164Phone(countryCode: string, localNumber: string): string | null {
  const country = countryCode.replace(/[^\d]/g, '');
  const local = localNumber.replace(/[^\d]/g, '');
  if (!/^[1-9]\d{0,2}$/.test(country)) return null;
  const number = `+${country}${local}`;
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null;
}
