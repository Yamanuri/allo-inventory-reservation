import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredReservations } from '@/lib/db-utils';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
  }

  try {
    const releasedCount = await cleanupExpiredReservations();
    return NextResponse.json({
      success: true,
      releasedCount,
      message: `Released ${releasedCount} expired reservation(s).`,
    });
  } catch (error) {
    console.error('Error running reservation cleanup:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'INTERNAL_SERVER_ERROR', message },
      { status: 500 }
    );
  }
}

// Vercel Cron uses GET by default; also accept POST for manual triggers
export async function POST(req: NextRequest) {
  return GET(req);
}
