CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('bishop','scheduler','viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability_rules (
  id BIGSERIAL PRIMARY KEY,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  preference TEXT NOT NULL CHECK (preference IN ('preferred','available')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  override_type TEXT NOT NULL CHECK (override_type IN ('add','block')),
  preference TEXT CHECK (preference IN ('preferred','available')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK ((override_type = 'add' AND preference IS NOT NULL) OR (override_type = 'block'))
);

CREATE TABLE IF NOT EXISTS recurring_interviews (
  id BIGSERIAL PRIMARY KEY,
  person_name TEXT NOT NULL,
  frequency_count INTEGER NOT NULL CHECK (frequency_count > 0),
  frequency_unit TEXT NOT NULL CHECK (frequency_unit IN ('days','weeks','months')),
  next_due_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointments (
  id BIGSERIAL PRIMARY KEY,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  person_name TEXT NOT NULL,
  appointment_type TEXT NOT NULL DEFAULT 'Interview',
  notes TEXT,
  confirmation_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (confirmation_status IN ('tentative','confirmed')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show','needs_rescheduling')),
  recurring_interview_id BIGINT REFERENCES recurring_interviews(id),
  created_by BIGINT REFERENCES users(id),
  updated_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

-- Migrations for existing databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE appointments ALTER COLUMN confirmation_status SET DEFAULT 'confirmed';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_confirmation_status_check'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_confirmation_status_check
      CHECK (confirmation_status IN ('tentative','confirmed'));
  END IF;
END $$;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurring_interview_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_recurring_interview_id_fkey'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_recurring_interview_id_fkey
      FOREIGN KEY (recurring_interview_id) REFERENCES recurring_interviews(id);
  END IF;
END $$;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status = 'scheduled');

CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_recurring ON appointments(recurring_interview_id);
CREATE INDEX IF NOT EXISTS idx_overrides_date ON availability_overrides(date);
CREATE INDEX IF NOT EXISTS idx_recurring_due ON recurring_interviews(active,next_due_date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings(key, value) VALUES
  ('timezone', 'America/Chicago'),
  ('slot_minutes', '15'),
  ('default_duration_minutes', '15')
ON CONFLICT (key) DO NOTHING;

UPDATE settings SET value='15' WHERE key='default_duration_minutes';
