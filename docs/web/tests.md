# Web: tests

Vitest, with fetch, camera and timers mocked.

## Unit cases
1. linkParser reads id and secret, then clears the fragment.
2. linkParser rejects a link with no secret (codeProblem).
3. api maps each error code to its typed error.
4. api never puts the token in a URL.
5. compressor output is JPEG, longest edge at most 1920, under 5 MB.
6. uploader never exceeds 5 in flight.
7. uploader requests the upload URL in parallel with compression.
8. uploader retries confirm after a network error and does not duplicate the photo.
9. uploader stops on SESSION_FINISHED.
10. lifecycle sends finish with a JSON body `{ token, graceSeconds: 30 }` on pagehide.
11. lifecycle calls resume when the page is visible again within the grace.
12. lifecycle finishes after 2 minutes idle.
13. state moves to ended on WebSocket close 4401 and 4410.
14. Token is stored in sessionStorage only.
15. camera denied leads to noCamera.
16. Claim failure leads to codeProblem for wrong secret and unknown session alike.
17. Thanks screen shows the store links from env.
18. Bundle stays under the size budget (build check).

## Real-device checklist
iPhone Safari and Android Chrome: camera prompt, rear camera, shoot 6 photos quickly, switch tab and return, lock the screen, kill the tab, scan from the traveler's app, photos arrive in the camera roll.
