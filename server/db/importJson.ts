import fs from 'fs';
import path from 'path';
import pkg from 'pg';
import { DATA_DIR, ORDERS_FILE, MESSAGES_FILE, REVIEWS_FILE, WORKSTREAM_UPLOAD_INDEX_FILE } from '../store.js';

const { Pool } = pkg;

async function importJsonToPostgres() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set. Skipping JSON to PostgreSQL import.');
    process.exit(0);
  }

  const pool = new Pool({ connectionString });
  console.log('Connecting to PostgreSQL for data import...');

  try {
    // 1. Import Orders
    if (fs.existsSync(ORDERS_FILE)) {
      const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
      if (Array.isArray(orders)) {
        for (const o of orders) {
          await pool.query(
            `INSERT INTO orders (id, title, buyer_id, seller_id, amount, status, created_at, due_date, completed_at, requirements, deliverables, deliverable_files, revisions, admin_notes, is_muted, escrow_protection_start_date, escrow_protection_end_date, gig_id, project_id, service_url, gig_slug, seller_username, buyer_username, service_title, service_thumbnail, is_timer_paused, fee_breakdown, delivery_history, delivery_notes, accepted_version, review_window_days, review_window_expires_at, review)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
             ON CONFLICT (id) DO NOTHING`,
            [
              o.id, o.title, o.buyerId, o.sellerId, o.amount, o.status,
              o.createdAt, o.dueDate, o.completedAt || null, o.requirements || null,
              o.deliverables || null, JSON.stringify(o.deliverableFiles || []),
              JSON.stringify(o.revisions || []), o.adminNotes || null, o.isMuted || false,
              o.escrowProtectionStartDate || null, o.escrowProtectionEndDate || null,
              o.gigId || null, o.projectId || null, o.serviceUrl || null,
              o.gigSlug || null, o.sellerUsername || null, o.buyerUsername || null,
              o.serviceTitle || null, o.serviceThumbnail || null, o.isTimerPaused || false,
              JSON.stringify(o.feeBreakdown || null), JSON.stringify(o.deliveryHistory || []),
              o.deliveryNotes || null, o.acceptedVersion || null, o.reviewWindowDays || null,
              o.reviewWindowExpiresAt || null, JSON.stringify(o.review || null)
            ]
          );
        }
        console.log(`Imported ${orders.length} orders into PostgreSQL.`);
      }
    }

    // 2. Import Messages
    if (fs.existsSync(MESSAGES_FILE)) {
      const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
      if (Array.isArray(messages)) {
        for (const m of messages) {
          await pool.query(
            `INSERT INTO messages (id, order_id, sender_id, sender_name, text, timestamp, type, file_info, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO NOTHING`,
            [m.id, m.orderId, m.senderId, m.senderName, m.text, m.timestamp, m.type || 'message', JSON.stringify(m.fileInfo || null), JSON.stringify(m.metadata || null)]
          );
        }
        console.log(`Imported ${messages.length} messages into PostgreSQL.`);
      }
    }

    // 3. Import Reviews
    if (fs.existsSync(REVIEWS_FILE)) {
      const reviews = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf-8'));
      if (Array.isArray(reviews)) {
        for (const r of reviews) {
          await pool.query(
            `INSERT INTO reviews (id, order_id, reviewer_id, reviewer_name, reviewer_avatar, target_user_id, rating, comment, order_title, gig_id, project_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (id) DO NOTHING`,
            [r.id, r.orderId || null, r.reviewerId || null, r.reviewerName || null, r.reviewerAvatar || null, r.targetUserId || null, r.rating, r.comment || null, r.orderTitle || null, r.gigId || null, r.projectId || null, r.createdAt || null]
          );
        }
        console.log(`Imported ${reviews.length} reviews into PostgreSQL.`);
      }
    }

    // 4. Import Upload Index
    if (fs.existsSync(WORKSTREAM_UPLOAD_INDEX_FILE)) {
      const uploads = JSON.parse(fs.readFileSync(WORKSTREAM_UPLOAD_INDEX_FILE, 'utf-8'));
      if (uploads && typeof uploads === 'object') {
        let count = 0;
        for (const [filename, rec] of Object.entries<any>(uploads)) {
          await pool.query(
            `INSERT INTO uploads (filename, owner_id, original_name, mime, size, created_at, sha256)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (filename) DO NOTHING`,
            [filename, rec.ownerId, rec.originalName || null, rec.mime || null, rec.size || 0, rec.createdAt, rec.sha256 || null]
          );
          count++;
        }
        console.log(`Imported ${count} upload records into PostgreSQL.`);
      }
    }

    console.log('JSON to PostgreSQL migration import completed successfully.');
  } catch (err) {
    console.error('Migration import failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importJsonToPostgres();
