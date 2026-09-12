-- Two notebooks, not a pile of notes.
--
-- The notepad let you make any number of titled notes, which is a filing
-- system nobody asked for: in practice there are two things worth writing
-- down and keeping open while composing — what you are trying to do, and the
-- pile of things you might post. Naming and choosing between notes was work
-- that produced nothing.
--
-- So a note now has a `kind`, there are exactly two, and neither can be
-- created or deleted. The title goes with them: "Strategy" and "Idea bank"
-- are the names, and they are in the code rather than typed in every time.

alter table notes
  add column if not exists kind text;

-- Anything already written is kept, folded into the idea bank rather than
-- lost. Oldest first, so it reads in the order it was written.
with existing as (
  select id, row_number() over (order by created_at) as n
  from notes
  where kind is null
)
update notes
set kind = case when existing.n = 1 then 'idea_bank' else null end
from existing
where notes.id = existing.id;

-- Everything beyond the first is merged into that one, then dropped, so the
-- two-notebook rule holds from here on.
do $$
declare
  keeper uuid;
  extra  record;
begin
  select id into keeper from notes where kind = 'idea_bank' limit 1;

  if keeper is not null then
    for extra in select id, content_html from notes where kind is null loop
      update notes
      set content_html = content_html || '<hr />' || coalesce(extra.content_html, '')
      where id = keeper;

      delete from notes where id = extra.id;
    end loop;
  end if;
end $$;

-- The two that must always exist.
insert into notes (kind, title, content, content_html)
select 'strategy', 'Strategy', '{}'::jsonb, ''
where not exists (select 1 from notes where kind = 'strategy');

insert into notes (kind, title, content, content_html)
select 'idea_bank', 'Idea bank', '{}'::jsonb, ''
where not exists (select 1 from notes where kind = 'idea_bank');

alter table notes
  drop constraint if exists notes_kind_check;

alter table notes
  add constraint notes_kind_check check (kind in ('strategy', 'idea_bank'));

alter table notes
  alter column kind set not null;

-- One of each, enforced by the database rather than by remembering to.
create unique index if not exists notes_kind_key on notes (kind);
