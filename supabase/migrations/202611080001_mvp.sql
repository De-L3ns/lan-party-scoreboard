begin;
create schema if not exists scoreboard_private;
revoke all on schema scoreboard_private from public, anon, authenticated;

create table public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

create table public.lan_sessions (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100),
  active boolean not null default true, created_at timestamptz not null default now(), archived_at timestamptz
);
create unique index one_active_lan on public.lan_sessions(active) where active;
create table public.players (
  id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 50),
  titles text[] not null default '{}', image_path text, archived boolean not null default false,
  revision integer not null default 0, created_at timestamptz not null default now()
);
create table public.session_players (
  session_id uuid references public.lan_sessions(id), player_id uuid references public.players(id),
  name text not null, titles text[] not null, image_path text, primary key(session_id, player_id)
);
create table public.games (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.lan_sessions(id),
  name text not null check(length(name) between 1 and 100), details text not null default '',
  direction text not null default 'higher' check(direction in ('higher','lower')),
  status text not null default 'setup' check(status in ('setup','drafting','ready','playing','completed')),
  draft_revision integer not null default 0, score_revision integer not null default 0,
  team_count integer not null default 0, pick_count integer not null default 0, total_players integer not null default 0,
  rolling boolean not null default false, roll_started_at timestamptz, created_at timestamptz not null default now()
);
create table public.game_participants (
  game_id uuid references public.games(id) on delete cascade, player_id uuid references public.players(id),
  name text not null, titles text[] not null, image_path text, primary key(game_id,player_id)
);
create table public.teams (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games(id),
  position integer not null check(position between 0 and 7), name text not null,
  result numeric(12,2), award jsonb, unique(game_id,position), unique(game_id,id)
);
create table public.team_members (
  game_id uuid not null, team_id uuid not null, player_id uuid not null, pick_index integer not null,
  primary key(game_id,player_id), unique(game_id,pick_index),
  foreign key(game_id,team_id) references public.teams(game_id,id) on delete cascade,
  foreign key(game_id,player_id) references public.game_participants(game_id,player_id)
);
create table public.score_events (
  id uuid primary key default gen_random_uuid(), session_id uuid not null references public.lan_sessions(id),
  game_id uuid references public.games(id), kind text not null check(kind in ('result','correction','adjustment','reversal')),
  reason text not null, payload jsonb not null default '{}', actor uuid not null references auth.users(id),
  reversed_event_id uuid unique references public.score_events(id), created_at timestamptz not null default now()
);
create table public.score_allocations (
  event_id uuid references public.score_events(id), player_id uuid references public.players(id),
  points numeric(12,2) not null, primary key(event_id,player_id)
);
create table public.game_awards (
  game_id uuid references public.games(id), player_id uuid references public.players(id),
  points numeric(12,2) not null, primary key(game_id,player_id)
);
create table public.board_updates (id integer primary key check(id=1), revision bigint not null default 0);
insert into public.board_updates(id) values(1);
create table scoreboard_private.draws (
  game_id uuid primary key references public.games(id), sequence uuid[] not null,
  pending_id uuid, pending_player uuid, pending_revision integer
);
create table scoreboard_private.requests (
  id uuid primary key, actor uuid not null, operation text not null, fingerprint text not null, result jsonb not null
);
create index games_session on public.games(session_id);
create index events_session on public.score_events(session_id);
create index allocations_player on public.score_allocations(player_id);

create function public.session_visible(p_session uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_admin() or exists(select 1 from public.lan_sessions where id=p_session and active)
$$;
revoke all on function public.session_visible(uuid) from public, anon, authenticated;
grant execute on function public.session_visible(uuid) to anon, authenticated;

alter table public.lan_sessions enable row level security;
alter table public.players enable row level security;
alter table public.session_players enable row level security;
alter table public.games enable row level security;
alter table public.game_participants enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.score_events enable row level security;
alter table public.score_allocations enable row level security;
alter table public.game_awards enable row level security;
alter table public.board_updates enable row level security;
revoke all on public.lan_sessions,public.players,public.session_players,public.games,public.game_participants,
 public.teams,public.team_members,public.score_events,public.score_allocations,public.game_awards,public.board_updates
 from public,anon,authenticated;
grant select on public.lan_sessions,public.players,public.session_players,public.games,public.game_participants,
 public.teams,public.team_members,public.board_updates to anon,authenticated;
create policy sessions_read on public.lan_sessions for select to anon,authenticated using(active or public.is_admin());
create policy players_read on public.players for select to anon,authenticated using(not archived or public.is_admin());
create policy session_players_read on public.session_players for select to anon,authenticated using(public.session_visible(session_id));
create policy games_read on public.games for select to anon,authenticated using(public.session_visible(session_id));
create policy participants_read on public.game_participants for select to anon,authenticated using(exists(select 1 from public.games g where g.id=game_id and public.session_visible(g.session_id)));
create policy teams_read on public.teams for select to anon,authenticated using(exists(select 1 from public.games g where g.id=game_id and public.session_visible(g.session_id)));
create policy members_read on public.team_members for select to anon,authenticated using(exists(select 1 from public.games g where g.id=game_id and public.session_visible(g.session_id)));
create policy updates_read on public.board_updates for select to anon,authenticated using(true);

create function scoreboard_private.require_admin() returns void language plpgsql set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
end $$;
create function scoreboard_private.lock_session(p_session uuid default null) returns uuid language plpgsql set search_path='' as $$
declare sid uuid;
begin
  select id into sid from public.lan_sessions where active and (p_session is null or id=p_session) for update;
  if sid is null then raise exception 'The LAN is archived or no longer active. Refresh and try again.'; end if;
  return sid;
end $$;
create function scoreboard_private.cached(p_id uuid,p_operation text,p_payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare old scoreboard_private.requests;
begin
  if p_id is null then raise exception 'Request ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into old from scoreboard_private.requests where id=p_id;
  if found then
    if old.actor<>auth.uid() or old.operation<>p_operation or old.fingerprint<>md5(p_payload::text) then raise exception 'Request ID reused for a different operation'; end if;
    return old.result;
  end if;
  return null;
end $$;
create function scoreboard_private.finish(p_id uuid,p_operation text,p_payload jsonb,p_result jsonb) returns jsonb language plpgsql set search_path='' as $$
begin
  insert into scoreboard_private.requests values(p_id,auth.uid(),p_operation,md5(p_payload::text),p_result);
  update public.board_updates set revision=revision+1 where id=1;
  return p_result;
end $$;
create function scoreboard_private.points(p_text text) returns numeric language plpgsql immutable set search_path='' as $$
begin
  if p_text is null or p_text !~ '^-?[0-9]+([.][0-9]{1,2})?$' then raise exception 'Enter a number with at most two decimal places'; end if;
  if abs(p_text::numeric)>9999999999.99 then raise exception 'Points exceed the supported range'; end if;
  return p_text::numeric;
end $$;

create function public.save_player(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; pid uuid; previous public.players; title_list text[]; image text;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'save_player',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if length(trim(p_input->>'name')) not between 1 and 50 or p_input->>'name' is null then raise exception 'Player name must be 1–50 characters'; end if;
  select coalesce(array_agg(value),'{}') into title_list from jsonb_array_elements_text(coalesce(p_input->'titles','[]'));
  if cardinality(title_list)>5 or exists(select 1 from unnest(title_list) as t(value) where length(value)>80) then raise exception 'Use up to five titles of 80 characters'; end if;
  image:=nullif(p_input->>'image_path','');
  if image is not null and (image !~ '^[a-zA-Z0-9/-]+[.]png$' or not exists(select 1 from storage.objects where bucket_id='player-images' and name=image)) then raise exception 'Upload the PNG before saving the player'; end if;
  if p_input->>'id' is not null then
    pid:=(p_input->>'id')::uuid;
    select * into strict previous from public.players where id=pid for update;
    if previous.revision<>(p_input->>'revision')::integer or p_input->>'revision' is null then raise exception 'Player changed. Reload before editing.'; end if;
    update public.players set name=trim(p_input->>'name'),titles=title_list,image_path=image,
      archived=coalesce((p_input->>'archived')::boolean,false),revision=revision+1 where id=pid;
  else
    insert into public.players(name,titles,image_path) values(trim(p_input->>'name'),title_list,image) returning id into pid;
  end if;
  insert into public.session_players(session_id,player_id,name,titles,image_path)
    select sid,id,name,titles,image_path from public.players where id=pid
    on conflict(session_id,player_id) do update set name=excluded.name,titles=excluded.titles,image_path=excluded.image_path;
  return scoreboard_private.finish(p_request_id,'save_player',p_input,jsonb_build_object('id',pid));
end $$;

create function public.create_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; gid uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'create_game',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if p_input->>'name' is null or length(trim(p_input->>'name')) not between 1 and 100 then raise exception 'Game name required (100 characters maximum)'; end if;
  if length(coalesce(p_input->>'details',''))>300 then raise exception 'Game details too long'; end if;
  insert into public.games(session_id,name,details,direction) values(sid,trim(p_input->>'name'),coalesce(p_input->>'details',''),coalesce(p_input->>'direction','higher')) returning id into gid;
  return scoreboard_private.finish(p_request_id,'create_game',p_input,jsonb_build_object('id',gid));
end $$;

create function public.prepare_draw(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; ids uuid[]; count_teams integer; i integer;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'prepare_draw',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game before drafting'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status not in ('setup','drafting','ready') then raise exception 'This game has already started'; end if;
  if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Draft changed. Reload before editing.'; end if;
  if g.total_players>0 and coalesce((p_input->>'confirm_redraw')::boolean,false)=false then raise exception 'Confirm the redraw first'; end if;
  select array_agg(value::uuid order by random()) into ids from jsonb_array_elements_text(p_input->'player_ids');
  count_teams:=(p_input->>'team_count')::integer;
  if ids is null or cardinality(ids) not between 2 and 64 or count_teams is null or count_teams not between 2 and 8 or count_teams>cardinality(ids) then raise exception 'Select 2–64 players and 2–8 nonempty teams'; end if;
  if (select count(distinct value) from unnest(ids) as chosen(value))<>cardinality(ids) then raise exception 'Duplicate player'; end if;
  if exists(select 1 from unnest(ids) as chosen(value) where not exists(select 1 from public.players p join public.session_players sp on sp.player_id=p.id and sp.session_id=sid where p.id=chosen.value and not p.archived)) then raise exception 'Choose active players from this LAN'; end if;
  delete from public.teams where game_id=g.id;
  delete from public.game_participants where game_id=g.id;
  insert into public.game_participants(game_id,player_id,name,titles,image_path) select g.id,id,name,titles,image_path from public.players where id=any(ids);
  for i in 0..count_teams-1 loop
    insert into public.teams(game_id,position,name) values(g.id,i,'Team '||chr(65+i));
  end loop;
  insert into scoreboard_private.draws(game_id,sequence) values(g.id,ids)
    on conflict(game_id) do update set sequence=excluded.sequence,pending_id=null,pending_player=null,pending_revision=null;
  update public.games set team_count=count_teams,total_players=cardinality(ids),pick_count=0,status='drafting',rolling=false,roll_started_at=null,draft_revision=draft_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'prepare_draw',p_input,jsonb_build_object('id',g.id));
end $$;

create function public.begin_roll(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.draws; sid uuid; output jsonb;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'begin_roll',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status<>'drafting' or g.pick_count>=g.total_players then raise exception 'No remaining draft picks'; end if;
  if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Draft changed. Refresh before rolling.'; end if;
  select * into strict d from scoreboard_private.draws where game_id=g.id for update;
  if d.pending_id is null then
    d.pending_id:=gen_random_uuid(); d.pending_player:=d.sequence[g.pick_count+1]; d.pending_revision:=g.draft_revision+1;
    update scoreboard_private.draws set pending_id=d.pending_id,pending_player=d.pending_player,pending_revision=d.pending_revision where game_id=g.id;
    update public.games set rolling=true,roll_started_at=now(),draft_revision=d.pending_revision where id=g.id;
  end if;
  select jsonb_build_object('id',d.pending_id,'game_id',g.id,'revision',d.pending_revision,'index',g.pick_count,
    'team_position',g.pick_count%g.team_count,'player',to_jsonb(p)) into output from public.game_participants p where p.game_id=g.id and p.player_id=d.pending_player;
  return scoreboard_private.finish(p_request_id,'begin_roll',p_input,output);
end $$;

create function public.commit_roll(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.draws; sid uuid; tid uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'commit_roll',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  select * into strict d from scoreboard_private.draws where game_id=g.id for update;
  if d.pending_id is null or p_input->>'roll_id' is null or d.pending_id<>(p_input->>'roll_id')::uuid or p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Pick changed or already committed. Refresh the draft.'; end if;
  select id into strict tid from public.teams where game_id=g.id and position=g.pick_count%g.team_count;
  insert into public.team_members(game_id,team_id,player_id,pick_index) values(g.id,tid,d.pending_player,g.pick_count);
  update scoreboard_private.draws set pending_id=null,pending_player=null,pending_revision=null where game_id=g.id;
  update public.games set pick_count=pick_count+1,draft_revision=draft_revision+1,rolling=false,roll_started_at=null,
    status=case when pick_count+1=total_players then 'ready' else 'drafting' end where id=g.id;
  return scoreboard_private.finish(p_request_id,'commit_roll',p_input,jsonb_build_object('player_id',d.pending_player,'team_id',tid));
end $$;

create function public.start_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'start_game',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status<>'ready' or p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Complete the draft and reload before starting'; end if;
  update public.games set status='playing',draft_revision=draft_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'start_game',p_input,jsonb_build_object('id',g.id));
end $$;

create function public.save_result(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; eid uuid; item jsonb; t public.teams; member record;
  amount numeric; cents bigint; share bigint; remainder bigint; size integer; idx integer; award numeric; old numeric; seen uuid[]:='{}';
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'save_result',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status not in ('ready','playing','completed') or g.pick_count<>g.total_players or g.total_players=0 then raise exception 'Finish the team draft before recording results'; end if;
  if p_input->>'revision' is null or g.score_revision<>(p_input->>'revision')::integer then raise exception 'Result changed. Reload and review before saving.'; end if;
  if p_input->>'board_revision' is null or (select revision from public.board_updates where id=1)<>(p_input->>'board_revision')::bigint then raise exception 'Scores changed. Close this form, refresh, and preview again.'; end if;
  if g.score_revision>0 and length(trim(coalesce(p_input->>'reason','')))=0 then raise exception 'A correction needs a reason'; end if;
  if length(coalesce(p_input->>'reason',''))>500 then raise exception 'Reason exceeds 500 characters'; end if;
  if jsonb_typeof(p_input->'teams') is distinct from 'array' or jsonb_array_length(p_input->'teams')<>g.team_count then raise exception 'Provide every team exactly once'; end if;
  insert into public.score_events(session_id,game_id,kind,reason,payload,actor)
    values(sid,g.id,case when g.score_revision=0 then 'result' else 'correction' end,coalesce(nullif(trim(p_input->>'reason'),''),g.name),p_input,auth.uid()) returning id into eid;
  for item in select value from jsonb_array_elements(p_input->'teams') loop
    select * into strict t from public.teams where id=(item->>'id')::uuid and game_id=g.id;
    if t.id=any(seen) then raise exception 'Duplicate team'; end if; seen:=array_append(seen,t.id);
    perform scoreboard_private.points(item->>'result');
    if item->>'mode' not in ('equal','split','custom') or item->>'mode' is null then raise exception 'Invalid award rule'; end if;
    select count(*) into size from public.team_members where team_id=t.id;
    amount:=case when item->>'mode'='custom' then 0 else scoreboard_private.points(item->>'amount') end;
    cents:=(amount*100)::bigint; share:=cents/size; remainder:=cents-share*size; idx:=0;
    for member in select player_id from public.team_members where team_id=t.id order by pick_index loop
      idx:=idx+1;
      award:=case item->>'mode' when 'equal' then amount when 'split' then (share+case when idx=size then remainder else 0 end)::numeric/100
        else scoreboard_private.points(item->'custom'->>member.player_id::text) end;
      select points into old from public.game_awards where game_id=g.id and player_id=member.player_id;
      insert into public.score_allocations(event_id,player_id,points) values(eid,member.player_id,award-coalesce(old,0));
      insert into public.game_awards values(g.id,member.player_id,award) on conflict(game_id,player_id) do update set points=excluded.points;
    end loop;
    update public.teams set result=scoreboard_private.points(item->>'result'),award=item-'id'-'result' where id=t.id;
  end loop;
  update public.games set status='completed',score_revision=score_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'save_result',p_input,jsonb_build_object('id',eid));
end $$;

create function public.adjust_points(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; eid uuid; original public.score_events;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'adjust_points',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if length(trim(coalesce(p_input->>'reason','')))=0 or length(p_input->>'reason')>500 then raise exception 'A reason is required (500 characters maximum)'; end if;
  if p_input->>'reverse_id' is not null then
    select * into strict original from public.score_events where id=(p_input->>'reverse_id')::uuid and session_id=sid and kind='adjustment' for update;
    if exists(select 1 from public.score_events where reversed_event_id=original.id) then raise exception 'Adjustment already reversed'; end if;
    insert into public.score_events(session_id,kind,reason,actor,reversed_event_id) values(sid,'reversal',trim(p_input->>'reason'),auth.uid(),original.id) returning id into eid;
    insert into public.score_allocations select eid,player_id,-points from public.score_allocations where event_id=original.id;
  else
    if not exists(select 1 from public.session_players where session_id=sid and player_id=(p_input->>'player_id')::uuid) then raise exception 'Player is not in this LAN'; end if;
    insert into public.score_events(session_id,kind,reason,actor) values(sid,'adjustment',trim(p_input->>'reason'),auth.uid()) returning id into eid;
    insert into public.score_allocations values(eid,(p_input->>'player_id')::uuid,scoreboard_private.points(p_input->>'points'));
  end if;
  return scoreboard_private.finish(p_request_id,'adjust_points',p_input,jsonb_build_object('id',eid));
end $$;

create function public.reset_lan(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; new_id uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'reset_lan',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null or coalesce((p_input->>'confirmed')::boolean,false)=false then raise exception 'Confirm which LAN to archive'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if p_input->>'name' is null or length(trim(p_input->>'name')) not between 1 and 100 then raise exception 'New LAN name required'; end if;
  update public.lan_sessions set active=false,archived_at=now() where id=sid;
  insert into public.lan_sessions(name) values(trim(p_input->>'name')) returning id into new_id;
  insert into public.session_players select new_id,id,name,titles,image_path from public.players where not archived;
  return scoreboard_private.finish(p_request_id,'reset_lan',p_input,jsonb_build_object('id',new_id));
end $$;

create function public.read_board(p_session_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.lan_sessions; output jsonb;
begin
  if p_session_id is null then select * into s from public.lan_sessions where active;
  else select * into s from public.lan_sessions where id=p_session_id; end if;
  if s.id is null then return null; end if;
  if not s.active and not public.is_admin() then raise exception 'Archived LANs are admin-only' using errcode='42501'; end if;
  select jsonb_build_object(
    'session',to_jsonb(s),'is_admin',public.is_admin(),'revision',(select revision from public.board_updates where id=1),
    'players',coalesce((select jsonb_agg(to_jsonb(sp)||jsonb_build_object('id',sp.player_id,'archived',p.archived,'revision',p.revision,'points',coalesce((select sum(a.points) from public.score_allocations a join public.score_events e on e.id=a.event_id where a.player_id=sp.player_id and e.session_id=s.id),0)) order by sp.name) from public.session_players sp join public.players p on p.id=sp.player_id where sp.session_id=s.id),'[]'),
    'games',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
      'participants',coalesce((select jsonb_agg(to_jsonb(gp) order by gp.name) from public.game_participants gp where gp.game_id=g.id),'[]'),
      'teams',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(m) order by m.pick_index) from public.team_members m where m.team_id=t.id),'[]')) order by t.position) from public.teams t where t.game_id=g.id),'[]'),
      'awards',coalesce((select jsonb_agg(to_jsonb(a)) from public.game_awards a where a.game_id=g.id),'[]')) order by g.created_at desc) from public.games g where g.session_id=s.id),'[]'),
    'roster',case when public.is_admin() then coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.players p),'[]') else '[]'::jsonb end,
    'sessions',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.lan_sessions l where l.active or public.is_admin()),'[]'),
    'events',case when public.is_admin() then coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.score_allocations a where a.event_id=e.id),'[]')) order by e.created_at desc) from public.score_events e where e.session_id=s.id),'[]') else '[]'::jsonb end
  ) into output;
  return output;
end $$;

revoke all on all functions in schema scoreboard_private from public,anon,authenticated;
revoke all on function public.save_player(jsonb,uuid),public.create_game(jsonb,uuid),public.prepare_draw(jsonb,uuid),public.begin_roll(jsonb,uuid),public.commit_roll(jsonb,uuid),public.start_game(jsonb,uuid),public.save_result(jsonb,uuid),public.adjust_points(jsonb,uuid),public.reset_lan(jsonb,uuid),public.read_board(uuid) from public,anon,authenticated;
grant execute on function public.read_board(uuid) to anon,authenticated;
grant execute on function public.save_player(jsonb,uuid),public.create_game(jsonb,uuid),public.prepare_draw(jsonb,uuid),public.begin_roll(jsonb,uuid),public.commit_roll(jsonb,uuid),public.start_game(jsonb,uuid),public.save_result(jsonb,uuid),public.adjust_points(jsonb,uuid),public.reset_lan(jsonb,uuid) to authenticated;

insert into public.lan_sessions(name) values('LAN Party');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('player-images','player-images',true,2097152,array['image/png'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=array['image/png'];
-- Immutable image versions preserve artwork referenced by historical snapshots.
create policy player_images_insert on storage.objects for insert to authenticated with check(bucket_id='player-images' and public.is_admin());
create policy player_images_admin_read on storage.objects for select to authenticated using(bucket_id='player-images' and public.is_admin());
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_updates') then
    alter publication supabase_realtime add table public.board_updates;
  end if;
end $$;
commit;
