import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/db-utils';

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get('idempotency-key');

  try {
    // 1. Handle Idempotency Key (Bonus)
    if (idempotencyKey) {
      const cached = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      if (cached) {
        return NextResponse.json(JSON.parse(cached.responseBody), {
          status: cached.responseStatus,
          headers: { 'x-cache-idempotency': 'true' },
        });
      }
    }

    // 2. Parse and Validate Body
    const body = await req.json();
    const { productId, warehouseId, quantity } = body;

    if (!productId || !warehouseId || typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        { error: 'BAD_REQUEST', message: 'Invalid input parameters.' },
        { status: 400 }
      );
    }

    // 3. Process reservation in a database transaction to ensure race-condition freedom
    const result = await prisma.$transaction(async (tx) => {
      // Run lazy cleanup inside the transaction context to ensure stock availability is correct
      await cleanupExpiredReservations(tx);

      // Perform an atomic update on the Stock table.
      // This is the core concurrency check: it locks the Stock row and checks stock availability.
      // If ("totalUnits" - "reservedUnits") >= quantity, it increments "reservedUnits".
      // Otherwise, the UPDATE affects 0 rows, signifying insufficient stock.
      const updatedRows = await tx.$executeRaw`
        UPDATE "Stock"
        SET "reservedUnits" = "reservedUnits" + ${quantity}
        WHERE "productId" = ${productId}
          AND "warehouseId" = ${warehouseId}
          AND ("totalUnits" - "reservedUnits") >= ${quantity}
      `;

      if (updatedRows === 0) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // Create the Reservation record
      const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
      const reservation = await tx.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          status: 'PENDING',
          expiresAt: expiryTime,
        },
        include: {
          product: true,
          warehouse: true,
        },
      });

      // Save the response for idempotency
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            responseStatus: 201,
            responseBody: JSON.stringify(reservation),
          },
        });
      }

      return reservation;
    });

    return NextResponse.json(result, { status: 201 });

  } catch (error) {
    const err = error as { code?: string; message?: string };
    // Catch concurrency key collisions (P2002) in case of parallel requests with the same key
    if (idempotencyKey && err.code === 'P2002') {
      const cached = await prisma.idempotencyKey.findUnique({
        where: { key: idempotencyKey },
      });
      if (cached) {
        return NextResponse.json(JSON.parse(cached.responseBody), {
          status: cached.responseStatus,
          headers: { 'x-cache-idempotency': 'true' },
        });
      }
    }

    if (err.message === 'INSUFFICIENT_STOCK') {
      const responseBody = { error: 'INSUFFICIENT_STOCK', message: 'Not enough stock available for the requested units.' };
      
      // Save 409 response for idempotency to ensure subsequent retries with the same key get the same response
      if (idempotencyKey) {
        try {
          await prisma.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              responseStatus: 409,
              responseBody: JSON.stringify(responseBody),
            },
          });
        } catch {
          // Ignore key collision on catch block
        }
      }
      return NextResponse.json(responseBody, { status: 409 });
    }

    console.error('Error in POST /api/reservations:', error);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: err.message || 'Failed to process reservation.' },
      { status: 500 }
    );
  }
}
