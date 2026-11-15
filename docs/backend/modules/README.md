# Backend modules: how they fit together

Module dependencies (no cycles): Sessions depends on Auth, Data, EventBus. Uploads and Delivery depend on Sessions. Realtime depends on Auth, Sessions, Delivery. Notifications depends on Realtime (presence), Data. Jobs depends on Sessions, Uploads, Delivery, Data. Sessions never calls Jobs; it only publishes events.
