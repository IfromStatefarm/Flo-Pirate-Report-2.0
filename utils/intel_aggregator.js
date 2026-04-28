//refractoring to make code more modular and easier to read, also adding new metrics for burndown time
/*Why: Currently, google_api.js is doing too much math. This file should be responsible for taking the "giant raw array" from Google Sheets and turning it into a "Tactical Object."

Move here: levenshtein, getConsolidatedEventName, normalize2k, and the massive loop inside fetchIntelligenceData.

Benefit: This logic can be unit-tested without needing a browser or a network connection.*/