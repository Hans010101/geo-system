import 'dotenv/config';
import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const indexes = [
  'CREATE INDEX idx_collections_questionId ON collections(questionId)',
  'CREATE INDEX idx_collections_platform ON collections(platform)',
  'CREATE INDEX idx_collections_status ON collections(status)',
  'CREATE INDEX idx_collections_timestamp ON collections(timestamp)',
  'CREATE INDEX idx_collections_batchId ON collections(batchId)',
  'CREATE INDEX idx_collections_composite ON collections(questionId, platform, timestamp)',
  'CREATE INDEX idx_citations_collectionId ON citations(collectionId)',
  'CREATE INDEX idx_analyses_collectionId ON analyses(collectionId)',
  'CREATE INDEX idx_alerts_createdAt ON alerts(createdAt)',
  'CREATE INDEX idx_alerts_isRead ON alerts(isRead)',
  'CREATE INDEX idx_alerts_composite ON alerts(createdAt, isRead)',
];

async function main() {
  const conn = await mysql.createConnection(DATABASE_URL);
  console.log('Connected to database');

  for (const sql of indexes) {
    try {
      await conn.execute(sql);
      console.log(`✓ ${sql.split(' ON ')[0]}`);
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log(`⊘ Already exists: ${sql.split(' ON ')[0]}`);
      } else {
        console.error(`✗ Failed: ${sql.split(' ON ')[0]}`, err.message);
      }
    }
  }

  await conn.end();
  console.log('Done');
}

main().catch(console.error);
