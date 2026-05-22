'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Warehouse {
  id: string;
  name: string;
  location: string;
}

interface Stock {
  productId: string;
  warehouseId: string;
  totalUnits: number;
  reservedUnits: number;
  warehouse: Warehouse;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  sku: string;
  stocks: Stock[];
}

interface ActiveReservation {
  id: string;
  productName: string;
  quantity: number;
  expiresAt: string;
}

export default function HomePage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Selected warehouse and quantity per product ID
  const [selections, setSelections] = useState<Record<string, { warehouseId: string; quantity: number }>>({});
  const [reserving, setReserving] = useState<Record<string, boolean>>({});
  const [reservationError, setReservationError] = useState<Record<string, string | null>>({});

  // Active local reservations tracker to guide user back if they left checkout
  const [activeLocalReservations, setActiveLocalReservations] = useState<ActiveReservation[]>([]);
  const [currentTime, setCurrentTime] = useState<number>(0);

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error('Failed to fetch products');
      }
      const data = await res.json();
      setProducts(data);

      // Initialize selections for products
      setSelections(prev => {
        const newSelections = { ...prev };
        data.forEach((product: Product) => {
          if (!newSelections[product.id]) {
            // Select the first warehouse with stock, or just the first warehouse
            const availableStock = product.stocks.find(s => (s.totalUnits - s.reservedUnits) > 0);
            const defaultWarehouseId = availableStock ? availableStock.warehouseId : (product.stocks[0]?.warehouseId || '');
            newSelections[product.id] = {
              warehouseId: defaultWarehouseId,
              quantity: 1
            };
          }
        });
        return newSelections;
      });
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Could not load products. Please check your database connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(Date.now());
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProducts();
    
    // Check localStorage for active reservations
    const saved = localStorage.getItem('allo_active_reservations');
    if (saved) {
      try {
        const list = JSON.parse(saved) as ActiveReservation[];
        // Filter out expired ones
        const now = new Date();
        const valid = list.filter(r => new Date(r.expiresAt) > now);
        setActiveLocalReservations(valid);
        // Save back filtered list
        localStorage.setItem('allo_active_reservations', JSON.stringify(valid));
      } catch {
        // Ignore JSON parse errors
      }
    }
  }, [fetchProducts]);

  const handleWarehouseChange = (productId: string, warehouseId: string) => {
    setSelections(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        warehouseId,
        quantity: 1 // Reset quantity when warehouse changes
      }
    }));
    setReservationError(prev => ({ ...prev, [productId]: null }));
  };

  const handleQuantityChange = (productId: string, qty: number, max: number) => {
    const validatedQty = Math.max(1, Math.min(qty, max));
    setSelections(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        quantity: validatedQty
      }
    }));
  };

  const handleReserve = async (product: Product) => {
    const sel = selections[product.id];
    if (!sel || !sel.warehouseId) return;

    const { warehouseId, quantity } = sel;
    
    setReserving(prev => ({ ...prev, [product.id]: true }));
    setReservationError(prev => ({ ...prev, [product.id]: null }));

    // Generate a unique idempotency key for this reservation attempt
    const idempotencyKey = typeof window !== 'undefined' && window.crypto?.randomUUID 
      ? window.crypto.randomUUID() 
      : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          productId: product.id,
          warehouseId,
          quantity,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setReservationError(prev => ({
          ...prev,
          [product.id]: 'Out of Stock! Someone else reserved these units concurrently.'
        }));
        // Refresh product stock levels to show latest state
        fetchProducts();
        return;
      }

      if (!res.ok) {
        throw new Error(data.message || 'Failed to create reservation');
      }

      // Successful reservation! Store in localStorage
      const newReservation: ActiveReservation = {
        id: data.id,
        productName: product.name,
        quantity: data.quantity,
        expiresAt: data.expiresAt,
      };

      const saved = localStorage.getItem('allo_active_reservations');
      let currentList: ActiveReservation[] = [];
      if (saved) {
        try { currentList = JSON.parse(saved); } catch { /* Ignore syntax errors */ }
      }
      currentList.push(newReservation);
      localStorage.setItem('allo_active_reservations', JSON.stringify(currentList));

      // Navigate to checkout page
      router.push(`/reservation/${data.id}`);

    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'An error occurred while reserving stock.';
      setReservationError(prev => ({
        ...prev,
        [product.id]: message
      }));
    } finally {
      setReserving(prev => ({ ...prev, [product.id]: false }));
    }
  };

  const removeLocalReservation = (id: string) => {
    const updated = activeLocalReservations.filter(r => r.id !== id);
    setActiveLocalReservations(updated);
    localStorage.setItem('allo_active_reservations', JSON.stringify(updated));
  };

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-12 md:py-20 flex flex-col gap-10">
      
      {/* Premium Header */}
      <div className="flex flex-col gap-3 text-center md:text-left">
        <span className="text-xs uppercase tracking-widest text-indigo-400 font-semibold">Inventory Management Platform</span>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
          Allo <span className="gradient-text-brand">Fulfillment Hub</span>
        </h1>
        <p className="text-slate-400 max-w-2xl text-sm md:text-base">
          Real-time double-fulfillment protection, utilizing transactional reservation locks to prevent race conditions during customer checkout.
        </p>
      </div>

      {/* Active Local Reservations Alert (if any exist) */}
      {activeLocalReservations.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl pulse-glow flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <h3 className="font-bold text-indigo-300">You have active checkout sessions!</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeLocalReservations.map((res) => (
              <div key={res.id} className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">{res.productName}</p>
                  <p className="text-xs text-slate-400">
                    Qty: {res.quantity} | Expires in:{' '}
                    {currentTime > 0
                      ? Math.max(0, Math.ceil((new Date(res.expiresAt).getTime() - currentTime) / 1000 / 60))
                      : '--'}{' '}
                    mins
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => router.push(`/reservation/${res.id}`)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold transition"
                  >
                    Resume
                  </button>
                  <button 
                    onClick={() => removeLocalReservation(res.id)}
                    className="px-2 py-1.5 hover:bg-slate-800 rounded-lg text-xs text-slate-400 transition"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Products Grid */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="glass-panel h-80 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      ) : error ? (
        <div className="glass-panel p-8 text-center rounded-2xl max-w-lg mx-auto flex flex-col gap-4">
          <p className="text-danger font-semibold">{error}</p>
          <button 
            onClick={fetchProducts}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold transition w-fit mx-auto text-sm"
          >
            Retry Connection
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {products.map((product) => {
            const sel = selections[product.id] || { warehouseId: '', quantity: 1 };
            const selectedStock = product.stocks.find(s => s.warehouseId === sel.warehouseId);
            const availableUnits = selectedStock ? selectedStock.totalUnits - selectedStock.reservedUnits : 0;
            const isOut = availableUnits <= 0;

            return (
              <div key={product.id} className="glass-panel glass-panel-hover rounded-3xl p-6 md:p-8 flex flex-col gap-6">
                
                {/* Title and Sku */}
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-mono text-indigo-400 tracking-wider font-semibold">{product.sku}</span>
                  <h2 className="text-xl font-bold tracking-tight">{product.name}</h2>
                  <p className="text-2xl font-extrabold text-slate-200 mt-2">${product.price.toFixed(2)}</p>
                </div>

                {/* Description */}
                <p className="text-slate-400 text-xs md:text-sm line-clamp-3 min-h-[4.5rem]">
                  {product.description || 'No description provided.'}
                </p>

                {/* Warehouse Stock Levels */}
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs uppercase tracking-wider text-slate-500 font-bold">Stock per Warehouse</h3>
                  <div className="flex flex-col gap-2">
                    {product.stocks.map((stock) => {
                      const avail = stock.totalUnits - stock.reservedUnits;
                      return (
                        <div key={stock.warehouseId} className="flex justify-between items-center text-xs p-2 rounded bg-slate-950/40 border border-slate-900">
                          <div>
                            <span className="font-semibold text-slate-300">{stock.warehouse.name.split(' (')[0]}</span>
                            <span className="text-slate-500 block text-[10px]">{stock.warehouse.location}</span>
                          </div>
                          <div className="text-right">
                            <span className="block font-semibold">
                              {avail} / {stock.totalUnits} <span className="text-slate-500">avail</span>
                            </span>
                            <span className="text-[10px] text-slate-500">({stock.reservedUnits} held)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Reservation Form */}
                <div className="mt-auto flex flex-col gap-4 border-t border-slate-800/80 pt-5">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Warehouse Selector */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase text-slate-500 font-bold">Warehouse</label>
                      <select 
                        value={sel.warehouseId}
                        onChange={(e) => handleWarehouseChange(product.id, e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs rounded-xl p-2.5 focus:outline-none focus:border-indigo-500 text-slate-200"
                      >
                        {product.stocks.map((s) => (
                          <option key={s.warehouseId} value={s.warehouseId}>
                            {s.warehouse.name.includes('Boston') ? 'Boston' : 'LA'} ({s.totalUnits - s.reservedUnits} avail)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Quantity Selector */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase text-slate-500 font-bold">Quantity</label>
                      <div className="flex border border-slate-800 rounded-xl overflow-hidden bg-slate-900">
                        <button 
                          disabled={isOut}
                          onClick={() => handleQuantityChange(product.id, sel.quantity - 1, availableUnits)}
                          className="flex-1 text-slate-400 hover:bg-slate-800 py-2 text-sm disabled:opacity-40"
                        >
                          -
                        </button>
                        <input 
                          type="number"
                          value={sel.quantity}
                          disabled={isOut}
                          onChange={(e) => handleQuantityChange(product.id, parseInt(e.target.value) || 1, availableUnits)}
                          className="w-10 text-center bg-transparent text-xs font-semibold focus:outline-none border-none text-slate-200"
                        />
                        <button 
                          disabled={isOut}
                          onClick={() => handleQuantityChange(product.id, sel.quantity + 1, availableUnits)}
                          className="flex-1 text-slate-400 hover:bg-slate-800 py-2 text-sm disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Reservation Error Message */}
                  {reservationError[product.id] && (
                    <div className="p-3 bg-red-950/40 border border-red-800/40 text-red-300 rounded-xl text-xs font-medium text-center">
                      {reservationError[product.id]}
                    </div>
                  )}

                  {/* Reserve Button */}
                  <button 
                    disabled={isOut || reserving[product.id]}
                    onClick={() => handleReserve(product)}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-slate-800/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/10"
                  >
                    {reserving[product.id] ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 border-2 border-white border-t-transparent animate-spin rounded-full"></span>
                        Reserving Hold...
                      </span>
                    ) : isOut ? (
                      'Out of Stock'
                    ) : (
                      'Reserve for Checkout'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
