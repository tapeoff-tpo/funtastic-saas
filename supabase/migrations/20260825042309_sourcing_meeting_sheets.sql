CREATE TABLE IF NOT EXISTS public.sourcing_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  meeting_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'open',
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_meetings_status_check CHECK (status IN ('open', 'closed', 'archived'))
);

CREATE INDEX IF NOT EXISTS sourcing_meetings_workspace_date_idx
  ON public.sourcing_meetings (user_id, meeting_date DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sourcing_meetings_workspace_legacy_unique
  ON public.sourcing_meetings (user_id)
  WHERE title = '이전 수집 데이터';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sourcing_meetings_status_check'
  ) THEN
    ALTER TABLE public.sourcing_meetings
      ADD CONSTRAINT sourcing_meetings_status_check
      CHECK (status IN ('open', 'closed', 'archived'));
  END IF;
END $$;

ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS meeting_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sourcing_items_meeting_id_fkey'
  ) THEN
    ALTER TABLE public.sourcing_items
      ADD CONSTRAINT sourcing_items_meeting_id_fkey
      FOREIGN KEY (meeting_id)
      REFERENCES public.sourcing_meetings(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sourcing_items_workspace_meeting_owner_updated_idx
  ON public.sourcing_items (user_id, meeting_id, owner_operator_id, updated_at DESC);

INSERT INTO public.sourcing_meetings (
  user_id,
  meeting_date,
  title,
  status
)
SELECT
  item.user_id,
  COALESCE(MIN(item.created_at)::date, CURRENT_DATE),
  '이전 수집 데이터',
  'archived'
FROM public.sourcing_items item
WHERE item.meeting_id IS NULL
GROUP BY item.user_id
ON CONFLICT DO NOTHING;

UPDATE public.sourcing_items item
SET meeting_id = meeting.id
FROM public.sourcing_meetings meeting
WHERE item.meeting_id IS NULL
  AND meeting.user_id = item.user_id
  AND meeting.title = '이전 수집 데이터';

ALTER TABLE public.sourcing_meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sourcing_meetings FROM anon, authenticated;
