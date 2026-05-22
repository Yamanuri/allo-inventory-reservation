'use client';

import { use, useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

interface Product {
  name: string;
  price: number;
  sku: string;
}

interface Warehouse {
  name: string;
  location: string;
}

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
  expiresAt: string;
  product: Product;
  warehouse: Warehouse;
}

interface ActiveReservation {
  id: string;
  productName: string;
  quantity: number;
  expiresAt: string;
}

export default function ReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(0); // in seconds
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Form actions state
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<{ error: string; message: string } | null>(null);

  // Local storage helper
  const removeReservationFromLocalStorage = useCallback((resId: string) => {
    try {
      const saved = localStorage.getItem('allo_active_reservations');
      if (saved) {
        const list = JSON.parse(saved) as ActiveReservation[];
        const filtered = list.filter((r) => r.id !== resId);
        localStorage.setItem('allo_active_reservations', JSON.stringify(filtered));
      }
    } catch {
      // Ignore localStorage read/write errors
    }
  }, []);

  // Fetch reservation details
  const fetchReservation = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/reservations/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Reservation session not found.');
        }
        throw new Error('Failed to load reservation details.');
      }
      const data: Reservation = await res.json();
      setReservation(data);
      setError(null);

      // Initialize timer if pending
      if (data.status === 'PENDING') {
        const expiry = new Date(data.expiresAt).getTime();
        const diff = Math.max(0, Math.floor((expiry - Date.now()) / 1000));
        setTimeLeft(diff);
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'An error occurred.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReservation();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchReservation]);

  // Handle countdown interval
  useEffect(() => {
    if (reservation && reservation.status === 'PENDING' && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            // Trigger local update when time runs out
            setReservation((prevRes) => {
              if (prevRes) {
                return { ...prevRes, status: 'RELEASED' };
              }
              return null;
            });
            // Try to release it on the backend as well (lazy cleanup)
            fetch(`/api/reservations/${id}/release`, { method: 'POST' }).catch(() => {});
            removeReservationFromLocalStorage(id);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [reservation, timeLeft, id, removeReservationFromLocalStorage]);

  const handleConfirm = async () => {
    if (!reservation) return;
    setSubmitting(true);
    setApiError(null);

    // Generate idempotency key for confirmation
    const idempotencyKey = `confirm-${id}`;

    try {
      const res = await fetch(`/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
      });

      const data = await res.json();

      if (res.status === 410) {
        // Reservation expired (410 Gone)
        setApiError({
          error: 'RESERVATION_EXPIRED',
          message: data.message || 'Your 10-minute hold has expired. The stock has been released to other shoppers.',
        });
        setReservation((prev) => prev ? { ...prev, status: 'RELEASED' } : null);
        removeReservationFromLocalStorage(id);
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || 'Failed to confirm purchase.');
      }

      // Success! Update local state
      setReservation(data);
      removeReservationFromLocalStorage(id);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Could not connect to server. Please try again.';
      setApiError({
        error: 'CONNECTION_ERROR',
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!reservation) return;
    setSubmitting(true);
    setApiError(null);

    try {
      const res = await fetch(`/api/reservations/${id}/release`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to cancel reservation.');
      }

      // Success! Update local state
      setReservation(data);
      removeReservationFromLocalStorage(id);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Could not cancel reservation. Please try again.';
      setApiError({
        error: 'CONNECTION_ERROR',
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to format remaining seconds into MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent animate-spin rounded-full"></div>
        <p className="mt-4 text-slate-400 font-semibold text-sm">Retrieving reservation details...</p>
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-md mx-auto text-center gap-6">
        <div className="h-16 w-16 bg-red-950/40 border border-red-800 rounded-full flex items-center justify-center text-red-500 text-3xl font-bold">!</div>
        <h2 className="text-2xl font-bold">Error</h2>
        <p className="text-slate-400 text-sm leading-relaxed">{error || 'Could not find checkout details.'}</p>
        <Link href="/" className="px-6 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl font-semibold transition text-sm">
          Return to Hub
        </Link>
      </div>
    );
  }

  const { product, warehouse, quantity, status } = reservation;
  const isPending = status === 'PENDING';
  const isConfirmed = status === 'CONFIRMED';
  const isReleased = status === 'RELEASED';
  const totalPrice = product.price * quantity;

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-12 md:py-20 flex flex-col gap-8">
      
      {/* Back Button */}
      <Link href="/" className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition w-fit">
        ← Back to Catalog
      </Link>

      {/* Main Reservation Card */}
      <div className={`glass-panel rounded-3xl p-8 flex flex-col gap-8 relative overflow-hidden ${isPending ? 'pulse-glow border-indigo-500/20' : ''}`}>
        
        {/* Glow decoration */}
        {isPending && (
          <div className="absolute top-0 right-0 h-40 w-40 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none"></div>
        )}

        {/* Status Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
          <div>
            <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">Reservation ID</span>
            <p className="text-xs font-mono text-slate-400 font-semibold">{id}</p>
          </div>
          <div className="flex items-center gap-3">
            {isPending && (
              <span className="px-3.5 py-1.5 bg-indigo-950/50 border border-indigo-500/40 text-indigo-300 text-xs font-bold rounded-full uppercase tracking-wider">
                Hold Active
              </span>
            )}
            {isConfirmed && (
              <span className="px-3.5 py-1.5 bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs font-bold rounded-full uppercase tracking-wider">
                Confirmed Paid
              </span>
            )}
            {isReleased && (
              <span className="px-3.5 py-1.5 bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs font-bold rounded-full uppercase tracking-wider">
                Hold Released
              </span>
            )}
          </div>
        </div>

        {/* Expiry Countdown (Only visible when Pending) */}
        {isPending && (
          <div className="flex flex-col items-center justify-center p-6 bg-indigo-950/20 border border-indigo-900/30 rounded-2xl gap-2 text-center">
            <span className="text-[10px] uppercase tracking-widest text-indigo-300/80 font-bold">Stock reservation expires in</span>
            <span className="text-4xl md:text-5xl font-black font-mono tracking-wider text-indigo-400">
              {formatTime(timeLeft)}
            </span>
            <p className="text-xs text-slate-400 max-w-sm mt-1">
              Your units are temporarily locked for checkout. If the timer runs out, the units will return to the available stock pool.
            </p>
          </div>
        )}

        {/* API Error Messages (Specifically 410 Expired message) */}
        {apiError && (
          <div className="p-4 bg-red-950/40 border border-red-800/40 text-red-300 rounded-2xl text-xs md:text-sm font-medium flex flex-col gap-1.5">
            <span className="font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
              ⚠️ {apiError.error.replace('_', ' ')}
            </span>
            <p className="text-slate-300">{apiError.message}</p>
          </div>
        )}

        {/* Order Details */}
        <div className="flex flex-col gap-4">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 font-bold">Items Details</h3>
          <div className="flex flex-col gap-4 bg-slate-950/30 p-5 rounded-2xl border border-slate-900">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="font-bold text-base md:text-lg text-slate-200">{product.name}</p>
                <p className="text-xs text-slate-400 mt-1">SKU: {product.sku}</p>
                <p className="text-xs text-slate-400">Warehouse: {warehouse.name} ({warehouse.location})</p>
              </div>
              <div className="text-right">
                <span className="block font-semibold text-slate-200">${product.price.toFixed(2)}</span>
                <span className="text-xs text-slate-500">x{quantity}</span>
              </div>
            </div>
            
            <div className="border-t border-slate-800/50 pt-4 flex justify-between items-center">
              <span className="text-sm text-slate-400 font-semibold">Total Amount Locked</span>
              <span className="text-xl font-extrabold text-indigo-300">${totalPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Interaction Actions */}
        {isPending && (
          <div className="flex flex-col md:flex-row gap-4 pt-4">
            {/* Cancel Button */}
            <button
              disabled={submitting}
              onClick={handleCancel}
              className="flex-1 py-4 border border-slate-800 hover:bg-slate-900/50 active:bg-slate-900 rounded-xl font-semibold text-slate-400 hover:text-slate-200 transition text-sm cursor-pointer disabled:opacity-40"
            >
              Cancel Hold
            </button>

            {/* Confirm Purchase Button */}
            <button
              disabled={submitting}
              onClick={handleConfirm}
              className="flex-1.5 py-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white rounded-xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10 disabled:opacity-40"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white border-t-transparent animate-spin rounded-full"></span>
                  Processing Payment...
                </span>
              ) : (
                'Confirm Purchase ($' + totalPrice.toFixed(2) + ')'
              )}
            </button>
          </div>
        )}

        {/* Status Confirmation states */}
        {isConfirmed && (
          <div className="p-6 bg-emerald-950/10 border border-emerald-900/30 rounded-2xl flex flex-col gap-3 text-center items-center">
            <span className="text-3xl">🎉</span>
            <h4 className="font-extrabold text-emerald-400 text-lg">Purchase Confirmed!</h4>
            <p className="text-xs text-slate-400 max-w-md">
              Your transaction is complete. The physical stock levels have been permanently decremented from the warehouse.
            </p>
            <Link href="/" className="mt-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold transition">
              Back to Catalog
            </Link>
          </div>
        )}

        {isReleased && (
          <div className="p-6 bg-rose-950/10 border border-rose-900/30 rounded-2xl flex flex-col gap-3 text-center items-center">
            <span className="text-3xl">⏳</span>
            <h4 className="font-extrabold text-rose-400 text-lg">Hold Released</h4>
            <p className="text-xs text-slate-400 max-w-md">
              The reserved units have been returned to the available stock pool. You can return to the catalog to try again.
            </p>
            <Link href="/" className="mt-2 px-5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-semibold transition">
              Back to Catalog
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
