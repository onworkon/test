INSERT INTO users (uid)
SELECT generate_series(0, 500)
ON CONFLICT (uid) DO NOTHING;

-- Sync booth data from ../booth.txt with `npm run booths:sync`.
-- Register NFC tags after reading their serial numbers:
-- npm run tag:upsert -- --tag-uid <tag_uid> --booth-id booth-101
-- Create the admin account after choosing a password:
-- npm run staff:upsert -- --role admin --password <password>
