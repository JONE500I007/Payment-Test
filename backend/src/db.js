import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const query = (text, params) => pool.query(text, params);

// Runs fn inside a transaction; rolls back on any thrown error.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Adds (or removes, if negative) coins and writes a ledger row. Must run inside a transaction.
export async function changeCoins(client, userId, amount, type, description) {
  const { rows } = await client.query(
    `UPDATE users SET coins = coins + $2
     WHERE id = $1 AND coins + $2 >= 0
     RETURNING coins`,
    [userId, amount],
  );
  if (!rows.length) {
    const err = new Error('Not enough coins');
    err.status = 400;
    throw err;
  }
  const balance = rows[0].coins;
  await client.query(
    `INSERT INTO coin_transactions (user_id, type, amount, balance_after, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, amount, balance, description],
  );
  return balance;
}
