ALTER TABLE public.user_menu_permissions
  ADD COLUMN IF NOT EXISTS can_delete_purchases boolean NOT NULL DEFAULT false;
