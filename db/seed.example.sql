INSERT INTO users (uid)
SELECT generate_series(0, 500)
ON CONFLICT (uid) DO NOTHING;

-- Booth data is intentionally not hardcoded here.
-- Run `npm run booths:sync` to apply the editable ../booth.txt source.

-- Register actual NFC tags after reading their serial numbers:
-- npm run tag:upsert -- --tag-uid <tag_uid> --booth-id booth-101

-- Create the admin account after choosing a password. Manager accounts come from booth.txt:
-- npm run staff:upsert -- --role admin --password <password>
