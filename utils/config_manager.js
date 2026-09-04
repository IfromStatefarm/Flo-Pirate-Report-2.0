/*utils/config_manager.js
Why: Logic for patchConfigSelector and checkIfAuthorized is scattered.

Move here: Everything related to events_config.json parsing and the "Handles White List" checks.

Benefit: It isolates customer business rules (who is allowed to post, which events are Double XP) from the technical rules (how to talk to Google).*/
