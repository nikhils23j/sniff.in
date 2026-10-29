// CricketData's Current Matches API is queried only from the server. The optional key never enters
// the mobile bundle. A shared database cache keeps the free 100-hit/day tier viable for small groups.
type Match = {
  name?: string;
  teams?: string[];
  dateTimeGMT?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
};

export function liveCricketOpener(data: unknown, now = new Date()): string | null {
  if (!Array.isArray(data)) return null;
  const matches = data as Match[];
  const live = matches.find((m) => {
    if (!m.matchStarted || m.matchEnded || !Array.isArray(m.teams) || m.teams.length !== 2) return false;
    const started = Date.parse(m.dateTimeGMT ?? '');
    return Number.isFinite(started) && started <= now.getTime() && now.getTime() - started < 5 * 24 * 60 * 60 * 1000;
  });
  if (!live) return null;
  const teams = live.teams!.map((t) => String(t).trim());
  if (teams.some((t) => !t || t.length > 35)) return null;
  const message = `Are you following ${teams[0]} vs ${teams[1]}? What do you think of the match so far?`;
  return message.length <= 140 ? message : null;
}
