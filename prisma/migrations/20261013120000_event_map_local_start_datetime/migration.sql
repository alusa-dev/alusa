ALTER TABLE "EventMap"
  ADD COLUMN "startsAtLocal" VARCHAR(16),
  ADD COLUMN "endsAtLocal" VARCHAR(16);

ALTER TABLE "EventMap"
  ADD CONSTRAINT "EventMap_startsAtLocal_format_check"
    CHECK ("startsAtLocal" IS NULL OR "startsAtLocal" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  ADD CONSTRAINT "EventMap_endsAtLocal_format_check"
    CHECK ("endsAtLocal" IS NULL OR "endsAtLocal" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$');
