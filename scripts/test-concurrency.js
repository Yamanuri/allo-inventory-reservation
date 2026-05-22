/**
 * Concurrency + idempotency smoke test.
 * Requires: dev server running (npm run dev) and DATABASE_URL set.
 *
 * Usage: npm run test:concurrency
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');


const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required. Set it in .env before running tests.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SERVER_URL = process.env.TEST_URL || 'http://localhost:3000';

async function runTests() {
  console.log('--- CONCURRENCY & IDEMPOTENCY TESTS ---\n');

  await prisma.stock.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  const warehouse = await prisma.warehouse.create({
    data: { name: 'Test Hub', location: 'Test Land' },
  });

  const productSingle = await prisma.product.create({
    data: { name: 'Single Stock Item', price: 9.99, sku: 'SKU-SINGLE' },
  });

  await prisma.stock.create({
    data: { productId: productSingle.id, warehouseId: warehouse.id, totalUnits: 1, reservedUnits: 0 },
  });

  const productMulti = await prisma.product.create({
    data: { name: 'Multi Stock Item', price: 14.99, sku: 'SKU-MULTI' },
  });

  await prisma.stock.create({
    data: { productId: productMulti.id, warehouseId: warehouse.id, totalUnits: 10, reservedUnits: 0 },
  });

  console.log('[1/3] Concurrency: two requests for the last unit...');
  const [res1, res2] = await Promise.all([
    fetch(`${SERVER_URL}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: productSingle.id,
        warehouseId: warehouse.id,
        quantity: 1,
      }),
    }),
    fetch(`${SERVER_URL}/api/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: productSingle.id,
        warehouseId: warehouse.id,
        quantity: 1,
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status];
  const success = statuses.filter((s) => s === 201).length;
  const conflict = statuses.filter((s) => s === 409).length;

  if (success !== 1 || conflict !== 1) {
    console.error(`FAILED: statuses=${statuses.join(', ')}`);
    process.exit(1);
  }
  console.log('PASSED: exactly one 201 and one 409.\n');

  console.log('[2/3] Reserve idempotency...');
  const reserveKey = `idem-${Date.now()}`;
  const payload = { productId: productMulti.id, warehouseId: warehouse.id, quantity: 2 };

  const idres1 = await fetch(`${SERVER_URL}/api/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'idempotency-key': reserveKey },
    body: JSON.stringify(payload),
  });
  const iddata1 = await idres1.json();

  const idres2 = await fetch(`${SERVER_URL}/api/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'idempotency-key': reserveKey },
    body: JSON.stringify(payload),
  });
  const iddata2 = await idres2.json();

  const stock = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId: productMulti.id, warehouseId: warehouse.id } },
  });

  if (
    idres1.status !== 201 ||
    idres2.status !== 201 ||
    iddata1.id !== iddata2.id ||
    idres2.headers.get('x-cache-idempotency') !== 'true' ||
    stock.reservedUnits !== 2
  ) {
    console.error('FAILED reserve idempotency');
    process.exit(1);
  }
  console.log('PASSED: duplicate key returns cached response, reservedUnits=2.\n');

  console.log('[3/3] Confirm idempotency...');
  const confirmKey = `confirm-${Date.now()}`;
  const confres1 = await fetch(`${SERVER_URL}/api/reservations/${iddata1.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': confirmKey },
  });
  const confres2 = await fetch(`${SERVER_URL}/api/reservations/${iddata1.id}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': confirmKey },
  });

  if (confres1.status !== 200 || confres2.status !== 200 || confres2.headers.get('x-cache-idempotency') !== 'true') {
    console.error('FAILED confirm idempotency');
    process.exit(1);
  }
  console.log('PASSED: confirm idempotency.\n');
  console.log('All tests passed.');
}

runTests()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
