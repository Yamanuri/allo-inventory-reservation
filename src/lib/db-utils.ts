import { Prisma } from '@prisma/client';
import prisma from './db';

/**
 * Releases expired PENDING reservations and returns held units to available stock.
 * Safe to call from transactions, cron jobs, or lazy cleanup on read.
 */
export async function cleanupExpiredReservations(
  txContext: Prisma.TransactionClient | typeof prisma = prisma
): Promise<number> {
  const now = new Date();

  const expiredReservations = await txContext.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now },
    },
  });

  if (expiredReservations.length === 0) {
    return 0;
  }

  const executeCleanup = async (tx: Prisma.TransactionClient) => {
    let releasedCount = 0;

    for (const res of expiredReservations) {
      const updated = await tx.reservation.updateMany({
        where: { id: res.id, status: 'PENDING' },
        data: { status: 'RELEASED' },
      });

      if (updated.count > 0) {
        await tx.$executeRaw`
          UPDATE "Stock"
          SET "reservedUnits" = CASE
            WHEN "reservedUnits" >= ${res.quantity} THEN "reservedUnits" - ${res.quantity}
            ELSE 0
          END
          WHERE "productId" = ${res.productId}
            AND "warehouseId" = ${res.warehouseId}
        `;
        releasedCount++;
      }
    }

    return releasedCount;
  };

  if (txContext === prisma) {
    return prisma.$transaction(executeCleanup);
  }

  return executeCleanup(txContext);
}
