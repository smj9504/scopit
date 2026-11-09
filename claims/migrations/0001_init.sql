-- Scopit Claims — Cloudflare D1 schema.
-- Apply with: npm run db:migrate:local  (or db:migrate:remote)

-- Public adjuster listings. A row starts as 'pending' when a PA applies.
-- Only an admin can move it to 'verified', and it is public only while at
-- least one of its licenses has a verified_on date and has not expired.
CREATE TABLE listings (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'verified', 'rejected', 'unlisted')),
  business_name        TEXT NOT NULL,
  contact_name         TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  website              TEXT,
  office_city          TEXT,
  office_state         TEXT,
  loss_types           TEXT NOT NULL DEFAULT '[]',   -- JSON array of loss type codes
  bio                  TEXT NOT NULL,
  terms_version        TEXT NOT NULL,                -- PA Listing Terms version agreed to
  agreements           TEXT NOT NULL,                -- JSON: which statements were ticked
  agreed_at            TEXT NOT NULL,                -- ISO timestamp
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  approved_on          TEXT,                         -- YYYY-MM-DD the listing first went live
  reviewed_at          TEXT,
  admin_note           TEXT,                         -- internal only, never shown publicly
  ip_hash              TEXT
);
CREATE INDEX idx_listings_status ON listings (status);
CREATE INDEX idx_listings_email ON listings (email);

-- One row per state license. verified_on is set by an admin after checking
-- the state's official license lookup, and is shown publicly as
-- "License verified on <date>".
CREATE TABLE listing_licenses (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id           TEXT NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  state                TEXT NOT NULL CHECK (state IN ('VA', 'MD', 'DC')),
  license_number       TEXT NOT NULL,
  expires_on           TEXT NOT NULL,                -- YYYY-MM-DD, entered by the PA
  verified_on          TEXT,                         -- YYYY-MM-DD, set by an admin
  verified_note        TEXT,                         -- internal: how it was checked
  UNIQUE (listing_id, state)
);
CREATE INDEX idx_licenses_listing ON listing_licenses (listing_id);

-- Homeowner inquiries. The message is sent only to the adjusters the
-- homeowner selected. Rows older than the retention period are deleted
-- automatically (see INQUIRY_RETENTION_DAYS).
CREATE TABLE inquiries (
  id                   TEXT PRIMARY KEY,
  created_at           TEXT NOT NULL,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL,
  phone                TEXT,
  location             TEXT,
  property_state       TEXT NOT NULL,
  loss_type            TEXT NOT NULL,
  repair_status        TEXT NOT NULL,
  message              TEXT NOT NULL,
  consent_text         TEXT NOT NULL,
  consent_at           TEXT NOT NULL,
  ip_hash              TEXT
);
CREATE INDEX idx_inquiries_created ON inquiries (created_at);

CREATE TABLE inquiry_recipients (
  inquiry_id           TEXT NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
  listing_id           TEXT NOT NULL,
  business_name        TEXT NOT NULL,
  delivery_status      TEXT NOT NULL DEFAULT 'queued'
                         CHECK (delivery_status IN ('queued', 'sent', 'failed')),
  provider_message_id  TEXT,
  PRIMARY KEY (inquiry_id, listing_id)
);

-- Per-IP submission counts for simple rate limiting. IPs are stored only as
-- salted hashes. Rows older than a day are pruned automatically.
CREATE TABLE rate_events (
  bucket               TEXT NOT NULL,
  ip_hash              TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_rate_events ON rate_events (bucket, ip_hash, created_at);
