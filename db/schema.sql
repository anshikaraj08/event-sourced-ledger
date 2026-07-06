-- schema.sql — the whole ledger. NO "balance" column anywhere; balance is
-- always derived by replaying entries.

CREATE TABLE IF NOT EXISTS accounts (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'user',   -- 'user' | 'external'
    currency    TEXT        NOT NULL DEFAULT 'INR',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
    id               BIGSERIAL PRIMARY KEY,
    description      TEXT        NOT NULL,
    idempotency_key  TEXT        UNIQUE,               -- retry-safety
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  BIGINT      NOT NULL REFERENCES transactions(id),
    account_id      BIGINT      NOT NULL REFERENCES accounts(id),
    direction       TEXT        NOT NULL CHECK (direction IN ('debit','credit')),
    amount          BIGINT      NOT NULL CHECK (amount > 0),   -- paise, positive
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- snapshots: an OPTIMIZATION (disposable cache), not a source of truth.
CREATE TABLE IF NOT EXISTS account_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    account_id    BIGINT      NOT NULL REFERENCES accounts(id),
    balance       BIGINT      NOT NULL,
    last_entry_id BIGINT      NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entries_account  ON entries(account_id, id);
CREATE INDEX IF NOT EXISTS idx_entries_created  ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_account ON account_snapshots(account_id, last_entry_id DESC);

-- The single EXTERNAL account: the counter-party for all deposits/withdrawals,
-- so the whole ledger always sums to zero.
INSERT INTO accounts (id, name, type)
VALUES (1, 'EXTERNAL_WORLD', 'external')
ON CONFLICT (id) DO NOTHING;

-- Advance the sequence past the hand-inserted id=1 (else first real account collides).
SELECT setval(pg_get_serial_sequence('accounts','id'), (SELECT MAX(id) FROM accounts));
