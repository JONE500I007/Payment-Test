import { pool } from './db.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  coins         INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id             SERIAL PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  icon           TEXT NOT NULL,
  rank           INTEGER NOT NULL,
  price_cents    INTEGER NOT NULL,
  monthly_coins  INTEGER NOT NULL,
  discount_pct   INTEGER NOT NULL,
  features       JSONB NOT NULL,
  popular        BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              INTEGER NOT NULL REFERENCES plans(id),
  status               TEXT NOT NULL CHECK (status IN ('active', 'replaced', 'expired')),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_sub_per_user
  ON subscriptions (user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS coin_packages (
  id          SERIAL PRIMARY KEY,
  coins       INTEGER NOT NULL,
  bonus       INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('topup', 'subscription')),
  amount_cents INTEGER NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'mock',
  status       TEXT NOT NULL DEFAULT 'paid',
  description  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coin_transactions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('topup', 'subscription_bonus', 'purchase', 'welcome')),
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL,
  icon          TEXT NOT NULL,
  category      TEXT NOT NULL,
  price_coins   INTEGER NOT NULL,
  min_plan_rank INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items(id),
  price_paid INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_id)
);

-- Stripe + profile settings
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_ref TEXT UNIQUE;
ALTER TABLE payments ALTER COLUMN provider SET DEFAULT 'stripe';

-- Language / currency preferences and THB prices (amounts in satang)
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'th'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency IN ('usd', 'thb'));
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_thb INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id_thb TEXT;
ALTER TABLE coin_packages ADD COLUMN IF NOT EXISTS price_thb INTEGER;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'usd';

-- Multiple providers (Stripe, Opn/Omise, PayPal): a payment starts 'pending' and is fulfilled once.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_ref TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS meta JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref ON payments (provider, provider_ref);
`;

const plans = [
  ['starter', 'Starter', 'Perfect for casual players getting started', 'auto_awesome', 1, 499, 15900, 500, 5,
    ['500 coins every month', '5% shop discount', 'Member badge', 'Exclusive items', 'Priority support'], false],
  ['pro', 'Pro', 'For regular shoppers who want more value', 'bolt', 2, 999, 32900, 1200, 10,
    ['1,200 coins every month', '10% shop discount', 'Member badge', 'Exclusive items', 'Priority support'], true],
  ['business', 'Business', 'Unlock exclusive items and bigger savings', 'crown', 3, 1999, 65900, 2600, 15,
    ['2,600 coins every month', '15% shop discount', 'Member badge', 'Exclusive items', 'Priority support'], false],
  ['ultimate', 'Ultimate', 'Everything we offer, at the best rate', 'diamond', 4, 3999, 129000, 6000, 20,
    ['6,000 coins every month', '20% shop discount', 'Member badge', 'Exclusive items', 'Priority support'], false],
];

// Which features each plan has (index into the shared feature list) — the rest render greyed out.
const planFeatureFlags = { starter: 3, pro: 4, business: 5, ultimate: 5 };

// [coins, bonus, USD cents, THB satang]
const coinPackages = [
  [100, 0, 99, 3500],
  [500, 50, 499, 16900],
  [1000, 200, 999, 32900],
  [2500, 500, 1999, 65900],
  [6000, 1500, 4999, 169000],
];

const items = [
  ['Neon Avatar Frame', 'A glowing frame around your profile picture', 'account_circle', 'Cosmetic', 150, 0],
  ['Midnight Theme', 'Dark purple dashboard theme', 'dark_mode', 'Theme', 300, 0],
  ['Rocket Emote Pack', '12 animated rocket emotes', 'rocket_launch', 'Emote', 250, 0],
  ['Golden Name Tag', 'Show your name in gold everywhere', 'military_tech', 'Cosmetic', 600, 0],
  ['Pixel Pet', 'A tiny companion that follows your cursor', 'pets', 'Companion', 800, 2],
  ['Aurora Theme', 'Animated northern-lights background', 'auto_awesome', 'Theme', 1200, 2],
  ['Crown Badge', 'A royal badge next to your name', 'workspace_premium', 'Badge', 2000, 3],
  ['Diamond Profile', 'The rarest profile style in the shop', 'diamond', 'Cosmetic', 4500, 4],
];

export async function migrate() {
  await pool.query(schema);

  for (const [code, name, description, icon, rank, price, priceThb, monthly, discount, featureNames, popular] of plans) {
    const enabled = planFeatureFlags[code];
    const features = featureNames.map((label, i) => ({ label, included: i < enabled }));
    await pool.query(
      `INSERT INTO plans (code, name, description, icon, rank, price_cents, monthly_coins, discount_pct, features, popular, price_thb)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon, rank = EXCLUDED.rank,
         price_cents = EXCLUDED.price_cents, monthly_coins = EXCLUDED.monthly_coins,
         discount_pct = EXCLUDED.discount_pct, features = EXCLUDED.features, popular = EXCLUDED.popular,
         price_thb = EXCLUDED.price_thb`,
      [code, name, description, icon, rank, price, monthly, discount, JSON.stringify(features), popular, priceThb],
    );
  }

  for (const [coins, bonus, price, priceThb] of coinPackages) {
    await pool.query(
      `INSERT INTO coin_packages (coins, bonus, price_cents, price_thb) VALUES ($1,$2,$3,$4)
       ON CONFLICT (price_cents) DO UPDATE SET coins = EXCLUDED.coins, bonus = EXCLUDED.bonus, price_thb = EXCLUDED.price_thb`,
      [coins, bonus, price, priceThb],
    );
  }

  for (const [name, description, icon, category, price, minRank] of items) {
    await pool.query(
      `INSERT INTO items (name, description, icon, category, price_coins, min_plan_rank)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, icon = EXCLUDED.icon,
         category = EXCLUDED.category, price_coins = EXCLUDED.price_coins, min_plan_rank = EXCLUDED.min_plan_rank`,
      [name, description, icon, category, price, minRank],
    );
  }
}
