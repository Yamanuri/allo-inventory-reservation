import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { cleanupExpiredReservations } from '@/lib/db-utils';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Lazy cleanup of expired reservations to ensure stock numbers are accurate
    await cleanupExpiredReservations();

    // 2. Fetch all products with their corresponding stock per warehouse
    const products = await prisma.product.findMany({
      include: {
        stocks: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    return NextResponse.json(products);
  } catch (error) {
    console.error('Error in GET /api/products:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal Server Error', message },
      { status: 500 }
    );
  }
}
