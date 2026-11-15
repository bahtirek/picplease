# Mobile: build order

5. **Core and requester app** (first platform): shared core, requester flow, push registration. Done when the phone shows the QR, receives photos (sent first by a scripted client or the web helper page), saves them to the camera roll, and survives a forced crash with no duplicates.
6. **Helper app** (first platform): camera, compression, upload pipeline, lifecycle. Done when a native helper claims by scanning, shoots while online, uploads continue with the app in the background, and recovery after a kill works.
7. **Shell and links**: deep links, push taps, cold-start restore, platform settings. Needs the Apple Team ID and Android signing fingerprints. Done when a QR scanned with the normal camera opens the app and a push tap opens Receiving.
8. **Second platform**: port both roles and pass the same cases.
