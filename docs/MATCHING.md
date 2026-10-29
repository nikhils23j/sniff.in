# Matching engine

Implemented in `public.discover_people(server_id, limit, offset)` (`supabase/migrations/20261018000600_rpc_social.sql`).

## Stage 1: eligibility (who may be shown)
A candidate is shown to viewer V in Server S only if **all** hold:
1. V is an active member of S, S is live (not archived; short-term not ended), and **V is available and discoverable in
   S** (reciprocity: lurking in DND is not possible).
2. Candidate is an active, onboarded account, an active member of S, `discoverable` in S, and currently available
   (`presence.available_until > now()`).
3. No block in either direction; not already connected; not dismissed by V (7 days); not rated "not a fit" by V.
4. Safety filter passes **both ways** (if either chose "same gender only", both must have self-declared the same gender).

Eligibility never depends on AI. Candidate set is capped at 1,000 per request; pages of ≤30, max 3 pages in the UI.

## Stage 2: ranking (deterministic, explainable)
Only data the candidate exposes at **members** visibility is used.

| Signal | Points |
|---|---|
| Shared interest / hobby / career tag (same name matches across these kinds) | +3 each |
| Shared skill | +2 each |
| Shared language | +1 each (beyond 2, contribution is cancelled out) |
| Same university/alma mater (both visible) | +4 |
| Their craving mentions one of my tags | +4 |
| My craving mentions one of their tags | +4 |
| Semantic similarity (only if flag on AND both consented AND embeddings exist) | +0 … +8 (`8·max(cos−0.2,0)/0.8`) |
| Active in the last 15 min | +0.5 |
| Positive private feedback from others (≥3 distinct raters) | up to +1, capped |

Ties: most recently active, then id. Each result returns `shared_tags` and human-readable `reasons`
("You both like Machine Learning, Badminton", "Both from IIT Kanpur", "Their craving matches your Badminton").

## Feedback, carefully
- **Dismiss ("not now")** hides a person from *your* results for 7 days. No effect on anyone else.
- **"Not a fit" (−1)** hides them from *your* recommendations permanently. **It never lowers their score for others**:
  no hidden cross-user penalties, so feedback can't become harassment or an unreviewable shadow-ban.
- **"Good conversation" (+1)** gives a tiny capped boost. Ratings are never displayed. Safety problems go through
  Report, which is human-reviewed.

The brief's "star ratings push low-rated users down" idea was intentionally not implemented, for the reasons above.

## Semantic layer (optional)
`embed-profile` Edge Function builds text from the user's *members-visible* fields only, embeds it (OpenAI
`text-embedding-3-small` at 1024 dims, or Voyage; provider-independent interface in `_shared/ai.ts`), and stores it in `profile_embeddings`
(no client access). Requires: `ai_features_consent = true`, flag `semantic_matching`, and `EMBEDDINGS_PROVIDER`
configured. Withdrawing consent deletes the vector on next call. If any piece is missing, ranking is purely
deterministic and the UI never claims AI was used.
