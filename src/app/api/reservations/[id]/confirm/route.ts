import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const idempotencyKey = req.headers.get('idempotency-key');

  try {
    // 1. Handle Idempotency Key
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

    // 2. Process confirmation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Find the reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        return { status: 404, data: { error: 'NOT_FOUND', message: 'Reservation not found.' } };
      }

      // If already confirmed, return success (idempotent)
      if (reservation.status === 'CONFIRMED') {
        return { status: 200, data: reservation };
      }

      // If already released, return error
      if (reservation.status === 'RELEASED') {
        return {
          status: 410,
          data: { error: 'RESERVATION_RELEASED', message: 'This reservation was already released and cannot be confirmed.' },
        };
      }

      // Check for expiration
      const now = new Date();
      if (reservation.expiresAt < now) {
        // Mark as RELEASED and return stock to pool
        await tx.reservation.update({
          where: { id },
          data: { status: 'RELEASED' },
        });

        await tx.$executeRaw`
          UPDATE "Stock"
          SET "reservedUnits" = CASE 
            WHEN "reservedUnits" >= ${reservation.quantity} THEN "reservedUnits" - ${reservation.quantity}
            ELSE 0 
          END
          WHERE "productId" = ${reservation.productId}
            AND "warehouseId" = ${reservation.warehouseId}
        `;

        const responseData = { error: 'RESERVATION_EXPIRED', message: 'This reservation has expired and the units have been released.' };
        
        if (idempotencyKey) {
          await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              responseStatus: 410,
              responseBody: JSON.stringify(responseData),
            },
          });
        }

        return { status: 410, data: responseData };
      }

      // Confirm the reservation
      const confirmedReservation = await tx.reservation.update({
        where: { id },
        data: { status: 'CONFIRMED' },
        include: {
          product: true,
          warehouse: true,
        },
      });

      // Permanently decrement stock
      await tx.$executeRaw`
        UPDATE "Stock"
        SET "totalUnits" = CASE 
              WHEN "totalUnits" >= ${reservation.quantity} THEN "totalUnits" - ${reservation.quantity}
              ELSE 0 
            END,
            "reservedUnits" = CASE 
              WHEN "reservedUnits" >= ${reservation.quantity} THEN "reservedUnits" - ${reservation.quantity}
              ELSE 0 
            END
        WHERE "productId" = ${reservation.productId}
          AND "warehouseId" = ${reservation.warehouseId}
      `;

      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            responseStatus: 200,
            responseBody: JSON.stringify(confirmedReservation),
          },
        });
      }

      return { status: 200, data: confirmedReservation };
    });

    return NextResponse.json(result.data, { status: result.status });

  } catch (error) {
    const err = error as { code?: string; message?: string };
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

    console.error(`Error confirming reservation ${id}:`, error);
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message: err.message || 'Failed to confirm reservation.' },
      { status: 500 }
    );
  }
}
