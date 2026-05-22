const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Use a hosted Postgres URL before seeding.');
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  await prisma.stock.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  const boston = await prisma.warehouse.create({
    data: {
      name: 'East Coast Fulfillment Center (Boston)',
      location: 'Boston, MA',
    },
  });

  const la = await prisma.warehouse.create({
    data: {
      name: 'West Coast Distribution Hub (Los Angeles)',
      location: 'Los Angeles, CA',
    },
  });

  const vit = await prisma.product.create({
    data: {
      name: 'Allo Daily Multi-Vitamin',
      description:
        'A comprehensive daily formula of essential vitamins and minerals designed to boost overall energy and immune health.',
      price: 29.99,
      sku: 'ALLO-VIT-001',
    },
  });

  const slp = await prisma.product.create({
    data: {
      name: 'Allo Sleep Support Gummy',
      description:
        'Delicious sleep gummies infused with melatonin, L-theanine, and chamomile to support deep, restful sleep.',
      price: 24.99,
      sku: 'ALLO-SLP-002',
    },
  });

  const str = await prisma.product.create({
    data: {
      name: 'Allo Stress Relief Adaptogen',
      description:
        'Formulated with premium KSM-66 Ashwagandha and Rhodiola Rosea to manage daily stress and support cortisol health.',
      price: 34.99,
      sku: 'ALLO-STR-003',
    },
  });

  await prisma.stock.createMany({
    data: [
      { productId: vit.id, warehouseId: boston.id, totalUnits: 10, reservedUnits: 0 },
      { productId: vit.id, warehouseId: la.id, totalUnits: 15, reservedUnits: 0 },
      { productId: slp.id, warehouseId: boston.id, totalUnits: 5, reservedUnits: 0 },
      { productId: slp.id, warehouseId: la.id, totalUnits: 8, reservedUnits: 0 },
      { productId: str.id, warehouseId: boston.id, totalUnits: 0, reservedUnits: 0 },
      { productId: str.id, warehouseId: la.id, totalUnits: 12, reservedUnits: 0 },
    ],
  });

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
