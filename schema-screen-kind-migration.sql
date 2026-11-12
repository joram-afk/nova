-- Add screen-reading notes to the allowed note kinds.
alter table public.notes drop constraint if exists notes_kind_check;
alter table public.notes add constraint notes_kind_check
  check (kind in ('note', 'transcript', 'ai', 'screen'));
