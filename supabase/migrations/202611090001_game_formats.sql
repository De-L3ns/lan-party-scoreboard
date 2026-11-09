begin;

-- Existing games retain their team draft. Free-for-all entries reuse the
-- result/award pipeline with one participant per entry and no wheel draft.
alter table public.games add column format text not null default 'teams'
  check(format in ('teams','ffa'));
alter table public.teams drop constraint teams_position_check;
alter table public.teams add constraint teams_position_check check(position between 0 and 63);

create or replace function public.create_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; gid uuid; game_format text;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'create_game',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if p_input->>'name' is null or length(trim(p_input->>'name')) not between 1 and 100 then raise exception 'Game name required (100 characters maximum)'; end if;
  if length(coalesce(p_input->>'details',''))>300 then raise exception 'Game details too long'; end if;
  game_format:=coalesce(p_input->>'format','teams');
  if game_format not in ('teams','ffa') then raise exception 'Choose team-based or free-for-all'; end if;
  insert into public.games(session_id,name,details,direction,format)
    values(sid,trim(p_input->>'name'),coalesce(p_input->>'details',''),coalesce(p_input->>'direction','higher'),game_format) returning id into gid;
  return scoreboard_private.finish(p_request_id,'create_game',p_input,jsonb_build_object('id',gid));
end $$;

create or replace function public.prepare_draw(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; ids uuid[]; count_teams integer; i integer; tid uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'prepare_draw',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game before setup'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status not in ('setup','drafting','ready') then raise exception 'This game has already started'; end if;
  if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Game setup changed. Reload before editing.'; end if;
  if g.total_players>0 and coalesce((p_input->>'confirm_redraw')::boolean,false)=false then raise exception 'Confirm replacing the existing game setup first'; end if;
  if jsonb_typeof(p_input->'player_ids') is distinct from 'array' then raise exception 'Select 2–64 different players'; end if;
  select array_agg(value::uuid order by ordinality) into ids from jsonb_array_elements_text(p_input->'player_ids') with ordinality;
  if ids is null or cardinality(ids) not between 2 and 64 then raise exception 'Select 2–64 different players'; end if;
  if (select count(distinct value) from unnest(ids) as chosen(value))<>cardinality(ids) then raise exception 'Duplicate or invalid player'; end if;
  if exists(select 1 from unnest(ids) as chosen(value) where not exists(select 1 from public.players p join public.session_players sp on sp.player_id=p.id and sp.session_id=sid where p.id=chosen.value and not p.archived)) then raise exception 'Choose active players from this LAN'; end if;
  if g.format='teams' then
    count_teams:=(p_input->>'team_count')::integer;
    if count_teams is null or count_teams not between 2 and 8 or count_teams>cardinality(ids) then raise exception 'Select 2–8 nonempty teams'; end if;
    select array_agg(value order by random()) into ids from unnest(ids) as chosen(value);
  else
    count_teams:=cardinality(ids);
  end if;

  delete from public.teams where game_id=g.id;
  delete from public.game_participants where game_id=g.id;
  insert into public.game_participants(game_id,player_id,name,titles,image_path)
    select g.id,id,name,titles,image_path from public.players where id=any(ids);

  if g.format='ffa' then
    for i in 1..cardinality(ids) loop
      insert into public.teams(game_id,position,name)
        select g.id,i-1,name from public.game_participants where game_id=g.id and player_id=ids[i] returning id into tid;
      insert into public.team_members(game_id,team_id,player_id,pick_index) values(g.id,tid,ids[i],i-1);
    end loop;
    delete from scoreboard_private.draws where game_id=g.id;
    update public.games set team_count=count_teams,total_players=cardinality(ids),pick_count=cardinality(ids),status='ready',
      rolling=false,roll_started_at=null,draft_revision=draft_revision+1 where id=g.id;
  else
    for i in 0..count_teams-1 loop
      insert into public.teams(game_id,position,name) values(g.id,i,'Team '||chr(65+i));
    end loop;
    insert into scoreboard_private.draws(game_id,sequence) values(g.id,ids)
      on conflict(game_id) do update set sequence=excluded.sequence,pending_id=null,pending_player=null,pending_revision=null;
    update public.games set team_count=count_teams,total_players=cardinality(ids),pick_count=0,status='drafting',
      rolling=false,roll_started_at=null,draft_revision=draft_revision+1 where id=g.id;
  end if;
  return scoreboard_private.finish(p_request_id,'prepare_draw',p_input,jsonb_build_object('id',g.id));
end $$;

-- CREATE OR REPLACE retains the MVP execution grants and admin checks.
commit;
