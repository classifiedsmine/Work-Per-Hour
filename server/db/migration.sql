-- PostgreSQL Schema Migration for WorkPerHour Store & Ledger
-- Run via migration runner or psql

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(128),
  email VARCHAR(255) UNIQUE NOT NULL,
  mobile VARCHAR(64),
  role VARCHAR(64) NOT NULL,
  avatar TEXT,
  title VARCHAR(255),
  rating NUMERIC(3,2) DEFAULT 5.0,
  reviews_count INT DEFAULT 0,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  earned NUMERIC(12,2) DEFAULT 0,
  completed_jobs INT DEFAULT 0,
  bio TEXT,
  skills TEXT[],
  status VARCHAR(32) DEFAULT 'active',
  verified BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  mobile_verified BOOLEAN DEFAULT FALSE,
  wallet_balance NUMERIC(12,2) DEFAULT 0,
  created_at VARCHAR(32),
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  password TEXT,
  session_version INT DEFAULT 1,
  known_devices TEXT[],
  is_available_now BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  buyer_id VARCHAR(64) NOT NULL,
  seller_id VARCHAR(64) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  due_date VARCHAR(32) NOT NULL,
  completed_at VARCHAR(32),
  requirements TEXT,
  deliverables TEXT,
  deliverable_files JSONB,
  revisions JSONB,
  admin_notes TEXT,
  is_muted BOOLEAN DEFAULT FALSE,
  escrow_protection_start_date VARCHAR(32),
  escrow_protection_end_date VARCHAR(32),
  gig_id VARCHAR(64),
  project_id VARCHAR(64),
  service_url TEXT,
  gig_slug VARCHAR(128),
  seller_username VARCHAR(128),
  buyer_username VARCHAR(128),
  service_title TEXT,
  service_thumbnail TEXT,
  is_timer_paused BOOLEAN DEFAULT FALSE,
  fee_breakdown JSONB,
  delivery_history JSONB,
  delivery_notes TEXT,
  accepted_version INT,
  review_window_days INT,
  review_window_expires_at VARCHAR(32),
  review JSONB
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id VARCHAR(64) NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  type VARCHAR(32) DEFAULT 'message',
  file_info JSONB,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) REFERENCES orders(id) ON DELETE SET NULL,
  reviewer_id VARCHAR(64),
  reviewer_name VARCHAR(255),
  reviewer_avatar TEXT,
  target_user_id VARCHAR(64),
  rating INT NOT NULL,
  comment TEXT,
  order_title TEXT,
  gig_id VARCHAR(64),
  project_id VARCHAR(64),
  created_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS uploads (
  filename VARCHAR(255) PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255),
  mime VARCHAR(128),
  size BIGINT,
  created_at VARCHAR(32) NOT NULL,
  sha256 VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS ledger_journals (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  reference VARCHAR(128),
  actor VARCHAR(128) NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id SERIAL PRIMARY KEY,
  journal_id VARCHAR(64) NOT NULL REFERENCES ledger_journals(id) ON DELETE CASCADE,
  wallet_id VARCHAR(64) NOT NULL,
  account_type VARCHAR(64) NOT NULL,
  direction VARCHAR(16) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_order_id ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_user_id ON reviews(target_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
