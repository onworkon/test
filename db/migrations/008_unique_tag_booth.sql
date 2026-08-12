DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM tag_maps
     GROUP BY booth_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each booth must have at most one NFC tag; resolve duplicate booth mappings before migrating';
  END IF;
END
$$;

ALTER TABLE tag_maps
  ADD CONSTRAINT tag_maps_booth_id_unique UNIQUE (booth_id);
