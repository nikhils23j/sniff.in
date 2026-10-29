# Data retention, expiry and deletion

What is **deleted** (rows removed from the primary database) vs **hidden** (still stored, not shown) vs **kept**.

| Data | Lifetime | Mechanism |
|---|---|---|
| Availability (presence) | Until the chosen expiry (15 min – 12 h) or DND | Server-side `available_until`; cleared by maintenance |
| Current craving | 1 h – 7 days | `expires_at`; deleted by maintenance; deleted when its Server ends |
| Ephemeral chat (short-term Server with disappearing chats) | Until the event `ends_at`, unless **both** people save the connection | `connections.expires_at`; maintenance deletes the connection → cascades conversation, participants, messages, icebreakers. Users are warned ~30 min before. |
| Saved connection / friendship | Until either person removes it or deletes their account | `remove_connection` deletes connection + chat for both |
| "Hide conversation" | Hidden for you only; reappears on new message | `conversation_participants.hidden_at` (not deletion) |
| Blocked connection | Chat becomes inaccessible to both immediately; rows kept for safety review until unblock | `connections.status = 'blocked'`; unblock deletes it |
| Activity posts | Optional expiry (default 7 days, max 30); short-term Server posts deleted when the Server ends | Deleted ~1 day after expiry |
| Connection requests | Pending requests expire after 30 days or when their event ends | Status `expired` |
| Notifications | 90 days | Deleted by maintenance |
| Rate-limit events | 2 days | Deleted by maintenance |
| Reports | Kept for moderation, including a **content snapshot** (disclosed in the privacy policy) | Reporter id nulled if the reporter deletes their account |
| Moderation audit log | Kept (accountability) | Actor/target ids nulled on account deletion |
| Profile embeddings | While AI consent is on | Deleted on consent withdrawal (next embed call) or account deletion |
| Account | Until the user deletes it | `delete-account` Edge Function: removes avatar files, deletes the auth user → FK cascade removes profile, private data, settings, memberships, tags, cravings, requests, connections, chats, messages they sent, posts, notifications, push tokens, embeddings |

## Honest limits
- Deletion is from the **primary database and Storage**. Supabase keeps backups / point-in-time recovery per the
  project's plan (typically up to 7 days for daily backups, longer with PITR). Deleted data ages out of backups on that
  schedule. We do **not** claim instant erasure from backups or provider logs.
- Push notifications already delivered to a device are outside our control (that's why payloads are generic by default).
- Screenshots and copies made by the other person cannot be prevented.
- The text in the app ("disappears when the event ends") reflects exactly the mechanism above.
