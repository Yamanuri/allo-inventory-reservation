# Allo Inventory & Reservation System

Hey! Thanks for taking the time to review my submission.

This is a Next.js (App Router) take-home project implementing temporary stock reservations to solve checkout race conditions. When a customer proceeds to checkout, we temporarily hold their items for **10 minutes**. If they complete payment, the stock is permanently decremented. If they cancel or let the timer run out, the hold is released back into the pool.

The data layer is built on **Postgres** (using Prisma) to guarantee correctness under concurrent checkout loads.

---

## The Concurrency Problem & Solution

### The Race Condition
If we only decrement stock *after* payment succeeds, two concurrent checkouts for the last unit of a product will both go through to payment. One customer will get a refund (and a bad experience), and operations has to clean up the mess.
If we decrement stock as soon as they add to cart, conversion drops because carts are abandoned.

### The Solution: Row-Level Atomic Updates
To make the reservation step race-condition-free, I implemented a conditional atomic update on the `Stock` table within a Prisma transaction:

```sql
UPDATE "Stock"
SET "reservedUnits" = "reservedUnits" + $quantity
WHERE "productId" = $productId
  AND "warehouseId" = $warehouseId
  AND ("totalUnits" - "reservedUnits") >= $quantity
```

Because Postgres locks the updated row for the duration of the transaction:
1. Two simultaneous checkouts will execute sequentially.
2. The first checkout updates the row and reserves the unit.
3. When the second checkout runs, the condition `(totalUnits - reservedUnits) >= quantity` evaluates to `false`. The update modifies `0` rows.
4. The API checks the affected row count. If it's `0`, we abort the transaction and return a `409 Conflict`.

---

## Auto-Expiry Mechanism

Holds shouldn't lock inventory forever. I built a three-tier cleanup system:

1. **Lazy Cleanup on Read**: Before pulling product lists (`GET /api/products`) or displaying the checkout page (`GET /api/reservations/:id`), the API runs a cleanup check to release any expired holds.
2. **Confirm Guard**: When confirming a payment (`POST /api/reservations/:id/confirm`), we check if the hold has expired. If it has, we reject the request with a `410 Gone` and release the stock.
3. **Cron Job (Vercel)**: `vercel.json` calls `/api/reservations/cleanup` every 5 minutes for automated asynchronous release in production.

---

## Bonus: Idempotency

I implemented client-side idempotency using an `IdempotencyKey` database table. By passing an `Idempotency-Key` header on `POST /api/reservations` or `POST /api/reservations/:id/confirm`, subsequent retries with the same key will return the cached response immediately, avoiding double-holds or double-charges.

---

## Local Setup

You can run the Postgres database locally via Docker, or connect to a cloud instance (like Neon or Supabase).

### 1. Configure the Environment
Copy the example environment file:
```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` and set your `DATABASE_URL`:
- **Docker Compose (local)**: `DATABASE_URL="postgresql://postgres:password@localhost:5432/allo_inventory?sslmode=disable"`
- **Cloud Postgres (Neon/Supabase)**: Use your hosted connection string.

### 2. Start PostgreSQL (If using Docker)
If you have Docker installed, start a local Postgres database:
```bash
docker-compose up -d
```

### 3. Run Migrations & Seed Data
```bash
npm install
npm run db:migrate:dev
npm run db:seed
```

### 4. Start the Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Run Concurrency & Idempotency Tests
To test the concurrent checkouts and retry logic under load:
```bash
npm run test:concurrency
```

---

## API Documentation

- **`GET /api/products`** - Get products and stock per warehouse (runs lazy cleanup).
- **`GET /api/warehouses`** - Get all warehouses.
- **`POST /api/reservations`** - Create a stock hold. Returns `409` if out of stock. Supports `Idempotency-Key` header.
- **`POST /api/reservations/:id/confirm`** - Confirm purchase. Returns `410` if expired. Supports `Idempotency-Key` header.
- **`POST /api/reservations/:id/release`** - Release hold early (e.g. user abandoned checkout).
- **`GET /api/reservations/cleanup`** - Manual/Cron cleanup trigger (secured via `Authorization: Bearer <CRON_SECRET>`).

---

## Architectural Choices & Trade-offs

- **Postgres row-level locks vs. Redis**: For this scope, Postgres row-level locks are robust and run on the same database instance, keeping operations simple. At massive scale, using Redis (like Upstash) for distributed locking would keep load off the primary database.
- **Idempotency storage**: I chose to store idempotency payloads in Postgres. In a high-traffic production system, we'd want to store these in Redis with a TTL (e.g., 24 hours) to avoid bloating our main database with old keys.
- **String Status vs. Enums**: Stored reservation status as a string in the schema to keep it flexible during migration, but used TypeScript string unions on the frontend and API levels to keep it type-safe.
