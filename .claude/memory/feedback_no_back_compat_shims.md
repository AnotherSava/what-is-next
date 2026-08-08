---
name: no-back-compat-shims
description: Single-deployment app — delete old names on rename instead of keeping aliases; zod defaults for already-stored data are the exception
metadata:
  type: feedback
---

This app has exactly one deployment and one user, so backward-compatibility shims are dead weight, not caution. When renaming a config key, a field, or an API, **delete the old name** — don't keep an alias "just in case". Prompted (2026-08-07) by `PLEX_VIEW_TTL_SECONDS`, which I kept as an alias for `MEDIA_VIEW_TTL_SECONDS` during the Plex→Media rename and which had never been set in Doppler at all: *"we don't have real users to bother about backwards compatibility."*

**Why:** an alias that protects nobody still has to be read, understood, and carried by everyone who touches the code later. Reflexive back-compat here is pure cost.

**How to apply:** delete on rename, and check the value's real source (Doppler, the DB, the settings row) before assuming anything depends on it — the alias I added turned out to be dead on arrival. The exception is **data already at rest**: a `z.string().default(…)` that keeps previously-stored `Setting` rows parseable is about existing data, not about users, and stays. Related: [[feedback_no_permanent_logic_for_one_time]], [[feedback_research_to_production_cleanup]].
