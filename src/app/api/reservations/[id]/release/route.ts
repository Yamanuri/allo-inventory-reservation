import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Find the reservation
      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        return { status: 404, data: { error: 'NOT_FOUND', message: 'Reservation not found.' } };
      }

      // If already released, return success (idempotent)
      if (reservation.status === 'RELEASED') {
        return { status: 200, data: reservation };
      }

      // If already confirmed, it's too late to release
      if (reservation.status === 'CONFIRMED') {
        return {
          status: 400,
          data: { error: 'ALREADY_CONFIRMED', message: 'This reservation has already been confirmed and paid for.' },
        };
      }

      // Release the reservation
      const releasedReservation = await tx.reservation.update({
        where: { id },
        data: { status: 'RELEASED' },
        include: {
          product: true,
          warehouse: true,
        },
      });

      // Release reserved stock back to the pool
      await tx.$executeRaw`
        UPDATE "Stock"
        SET "reservedUnits" = CASE 
          WHEN "reservedUnits" >= ${reservation.quantity} THEN "reservedUnits" - ${reservation.quantity}
          ELSE 0 
        END
        WHERE "productId" = ${reservation.productId}
          AND "warehouseId" = ${reservation.warehouseId}
      `;

      return { status: 200, data: releasedReservation };
    });

    return NextResponse.json(result.data, { status: result.status });

  } catch (error) {
    console.error(`Error releasing reservation ${id}:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message },
      { status: 500 }
    );
  }
}
