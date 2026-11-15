# Backend: test plan

Use a real Postgres for repository tests and a fake R2.

| Area | Cases |
|---|---|
| Sessions (8) | Create stores only hashes and publishes created. A claim succeeds once and a second conflicts. A claim after expiry fails. A wrong secret looks like an unknown session. Revoke works from pending, claimed and finished, refused from terminal. Finish only from claimed. `expirePending` leaves a claimed session alone. `markClosed` only from finished. |
| Uploads (9) | Issue before claim refused. Issue after finish refused. The 6th simultaneous request refused. Confirm twice succeeds with one event. Missing object rejected. Wrong size rejected. Confirm after revoke rejected. Confirm after finish accepted. A late upload after revoke is deleted, not promoted. |
| Delivery (12) | Pending lists only uploaded, unsaved photos, oldest first. Refused after revoke. Another session's photo refused. Not-yet-uploaded photo refused. Acknowledge twice harmless. Acknowledge deletes the object. Window closes only when finished, nothing in flight, everything downloaded. Window stays open with one in flight. Re-checked when a stale photo is discarded. Zero photos closes immediately. Revoke deletes undelivered objects. Revoke leaves downloaded photos alone. |
| Realtime (7) | Valid requester token joins and gets a snapshot. Bad token rejected. Helper gets no photo events. Requester gets `photo.ready`. Reconnect snapshot includes pending photos. Disconnect clears presence. `isRequesterOnline` only while connected. |
| Notifications (6) | Push when offline. No push when online. One push per burst. Invalid token removed. Registering twice updates. No photo content in the message. |
| Jobs (8) | Created schedules the timer. Claimed cancels it. Expiry on a claimed session does nothing. Idle claimed session auto-finished. Active session not. Stale photo reconciled. Hard delete removes photos over 48 hours. Hard delete leaves fresh photos. |
| EventBus (6) | One subscriber. Several subscribers. Unsubscribe. Payload unchanged. Reconnect re-listens. A rolled-back transaction never delivers. |
| Auth (8) | Secret length and uniqueness. Hash then verify. Wrong value fails. Format round-trips. Malformed rejected. Missing token unauthorized. Helper token refused on requester routes and the reverse. Valid token attaches context. |
| Data layer (10) | Two concurrent claims, one wins. Claim after expiry fails. Sixth concurrent reservation refused. Wrong-state transition returns nothing. `touchActivity` changes the idle query. Purge cascades. R2: head on missing, delete twice, URL expires, key never from client input. |
