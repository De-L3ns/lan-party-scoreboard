begin;

alter table public.games drop constraint games_format_check;
alter table public.games add constraint games_format_check check(format in ('teams','ffa','knockout'));
alter table public.games add column tournament_revision integer not null default 0;

-- Only published identities live in public records. The original seed layout is private.
create table public.knockout_matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  round integer not null check(round between 0 and 5),
  position integer not null check(position between 0 and 31),
  published boolean not null default false,
  player1 uuid, player2 uuid, winner_id uuid,
  status text not null default 'waiting' check(status in ('waiting','ready','bye','complete')),
  unique(game_id,round,position), unique(game_id,id),
  foreign key(game_id,player1) references public.game_participants(game_id,player_id),
  foreign key(game_id,player2) references public.game_participants(game_id,player_id),
  foreign key(game_id,winner_id) references public.game_participants(game_id,player_id),
  check(player1 is null or player2 is null or player1<>player2),
  check(winner_id is null or winner_id is not distinct from player1 or winner_id is not distinct from player2),
  check(status not in ('ready','complete') or (player1 is not null and player2 is not null)),
  check(status not in ('bye','complete') or winner_id is not null),
  check(published or (player1 is null and player2 is null and winner_id is null))
);
create table public.knockout_events (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  match_id uuid not null,
  kind text not null check(kind in ('opening','ready')),
  player1 uuid, player2 uuid, valid boolean not null default true,
  foreign key(game_id,match_id) references public.knockout_matches(game_id,id) on delete cascade
);
create table scoreboard_private.knockout_draws (
  game_id uuid primary key references public.games(id) on delete cascade,
  layout uuid[] not null, next_position integer not null default 0,
  pending_id uuid, pending_revision integer
);
create table scoreboard_private.knockout_results (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id),
  match_id uuid not null references public.knockout_matches(id) on delete cascade,
  winner_id uuid not null, actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz, reversed_by uuid references auth.users(id)
);
create index knockout_results_game on scoreboard_private.knockout_results(game_id,id desc);
alter table public.knockout_matches enable row level security;
alter table public.knockout_events enable row level security;
revoke all on public.knockout_matches,public.knockout_events from public,anon,authenticated;
revoke all on scoreboard_private.knockout_draws,scoreboard_private.knockout_results from public,anon,authenticated;
grant select on public.knockout_matches,public.knockout_events to anon,authenticated;
create policy knockout_matches_read on public.knockout_matches for select to anon,authenticated
  using(exists(select 1 from public.games g where g.id=game_id and public.session_visible(g.session_id)));
create policy knockout_events_read on public.knockout_events for select to anon,authenticated
  using(exists(select 1 from public.games g where g.id=game_id and public.session_visible(g.session_id)));

create function scoreboard_private.knockout_lock(p_input jsonb,p_states text[]) returns public.games
language plpgsql set search_path='' as $$
declare g public.games; sid uuid;
begin
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a tournament'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.format<>'knockout' or not g.status=any(p_states) then raise exception 'This tournament cannot be changed in its current state'; end if;
  if p_input->>'tournament_revision' is null or g.tournament_revision<>(p_input->>'tournament_revision')::integer then
    raise exception 'Tournament changed. Refresh and review before continuing.';
  end if;
  return g;
end $$;

-- Recompute fixed feeder slots, publishing only newly ready later-round pairings.
create function scoreboard_private.advance_knockout(p_game uuid) returns void
language plpgsql set search_path='' as $$
declare m public.knockout_matches; a public.knockout_matches; b public.knockout_matches;
  p1 uuid; p2 uuid; new_status text; new_winner uuid;
begin
  for m in select * from public.knockout_matches where game_id=p_game order by round,position loop
    if m.round=0 then
      if not m.published then continue; end if;
      p1:=m.player1; p2:=m.player2;
    else
      select * into strict a from public.knockout_matches where game_id=p_game and round=m.round-1 and position=m.position*2;
      select * into strict b from public.knockout_matches where game_id=p_game and round=m.round-1 and position=m.position*2+1;
      p1:=a.winner_id; p2:=b.winner_id;
    end if;
    new_winner:=m.winner_id;
    if m.round=0 and (p1 is null or p2 is null) then new_status:='bye'; new_winner:=coalesce(p1,p2);
    elsif p1 is not null and p2 is not null then
      new_status:=case when new_winner is null then 'ready' else 'complete' end;
    else new_status:='waiting'; new_winner:=null;
    end if;
    update public.knockout_matches set player1=p1,player2=p2,status=new_status,winner_id=new_winner where id=m.id;
    if m.round>0 and new_status='ready' and m.status<>'ready' then
      insert into public.knockout_events(game_id,match_id,kind,player1,player2) values(p_game,m.id,'ready',p1,p2);
    end if;
  end loop;
end $$;

create function scoreboard_private.knockout_place(p_game uuid,p_player uuid) returns integer
language plpgsql stable set search_path='' as $$
declare final public.knockout_matches; lost_round integer;
begin
  select * into strict final from public.knockout_matches where game_id=p_game order by round desc limit 1;
  if final.status<>'complete' then raise exception 'Finish the final before recording awards'; end if;
  if final.winner_id=p_player then return 1; end if;
  select round into lost_round from public.knockout_matches
    where game_id=p_game and status='complete' and p_player in (player1,player2) and winner_id<>p_player;
  if lost_round is null then raise exception 'Participant has no finishing place'; end if;
  return (2 ^ (final.round-lost_round))::integer+1;
end $$;

create function public.begin_knockout_reveal(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.knockout_draws; output jsonb;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'begin_knockout_reveal',p_input); if cached is not null then return cached; end if;
  g:=scoreboard_private.knockout_lock(p_input,array['drafting']);
  if exists(select 1 from public.games where session_id=g.session_id and status='playing') then raise exception 'Finish the active game before drawing'; end if;
  select * into strict d from scoreboard_private.knockout_draws where game_id=g.id for update;
  if d.pending_id is null then
    d.pending_id:=gen_random_uuid(); d.pending_revision:=g.tournament_revision+1;
    update scoreboard_private.knockout_draws set pending_id=d.pending_id,pending_revision=d.pending_revision where game_id=g.id;
    update public.games set tournament_revision=d.pending_revision,draft_revision=draft_revision+1,rolling=true,roll_started_at=now() where id=g.id;
  end if;
  output:=jsonb_build_object('id',d.pending_id,'tournament_revision',d.pending_revision,'position',d.next_position);
  return scoreboard_private.finish(p_request_id,'begin_knockout_reveal',p_input,output);
end $$;

create function public.commit_knockout_reveal(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.knockout_draws; m public.knockout_matches;
  p1 uuid; p2 uuid; eid bigint;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'commit_knockout_reveal',p_input); if cached is not null then return cached; end if;
  g:=scoreboard_private.knockout_lock(p_input,array['drafting']);
  if exists(select 1 from public.games where session_id=g.session_id and status='playing') then raise exception 'Finish the active game before drawing'; end if;
  select * into strict d from scoreboard_private.knockout_draws where game_id=g.id for update;
  if d.pending_id is null or p_input->>'reveal_id' is null or d.pending_id<>(p_input->>'reveal_id')::uuid
    or d.pending_revision<>g.tournament_revision then raise exception 'Reveal changed. Refresh and resume.'; end if;
  select * into strict m from public.knockout_matches where game_id=g.id and round=0 and position=d.next_position for update;
  if m.published then raise exception 'Pairing already published'; end if;
  p1:=d.layout[d.next_position*2+1]; p2:=d.layout[d.next_position*2+2];
  update public.knockout_matches set published=true,player1=p1,player2=p2 where id=m.id;
  insert into public.knockout_events(game_id,match_id,kind,player1,player2)
    values(g.id,m.id,'opening',p1,p2) returning id into eid;
  perform scoreboard_private.advance_knockout(g.id);
  update scoreboard_private.knockout_draws set next_position=next_position+1,pending_id=null,pending_revision=null where game_id=g.id;
  update public.games set pick_count=pick_count+(case when p1 is null then 0 else 1 end)+(case when p2 is null then 0 else 1 end),
    status=case when (d.next_position+1)*2=cardinality(d.layout) then 'ready' else 'drafting' end,
    rolling=false,roll_started_at=null,draft_revision=draft_revision+1,tournament_revision=tournament_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'commit_knockout_reveal',p_input,jsonb_build_object('match_id',m.id,'event_id',eid::text));
end $$;

create function public.record_knockout_winner(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; m public.knockout_matches; chosen uuid; result_id bigint;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'record_knockout_winner',p_input); if cached is not null then return cached; end if;
  g:=scoreboard_private.knockout_lock(p_input,array['playing']);
  select * into strict m from public.knockout_matches where game_id=g.id and id=(p_input->>'match_id')::uuid for update;
  chosen:=(p_input->>'winner_id')::uuid;
  if m.status<>'ready' or chosen is null or chosen not in (m.player1,m.player2) then raise exception 'Choose a player in a ready match'; end if;
  update public.knockout_matches set winner_id=chosen,status='complete' where id=m.id;
  insert into scoreboard_private.knockout_results(game_id,match_id,winner_id,actor)
    values(g.id,m.id,chosen,auth.uid()) returning id into result_id;
  perform scoreboard_private.advance_knockout(g.id);
  update public.games set tournament_revision=tournament_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'record_knockout_winner',p_input,jsonb_build_object('result_id',result_id::text));
end $$;

create function public.undo_knockout_result(p_input jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; last_result scoreboard_private.knockout_results;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'undo_knockout_result',p_input); if cached is not null then return cached; end if;
  g:=scoreboard_private.knockout_lock(p_input,array['playing']);
  if not coalesce((p_input->>'confirmed')::boolean,false) then raise exception 'Confirm undoing the last result'; end if;
  select * into strict last_result from scoreboard_private.knockout_results where game_id=g.id and reversed_at is null order by id desc limit 1 for update;
  if p_input->>'result_id' is null or last_result.id<>(p_input->>'result_id')::bigint then raise exception 'Last result changed. Refresh before undoing.'; end if;
  update public.knockout_matches set winner_id=null,status='ready' where id=last_result.match_id;
  update scoreboard_private.knockout_results set reversed_at=now(),reversed_by=auth.uid() where id=last_result.id;
  perform scoreboard_private.advance_knockout(g.id);
  update public.knockout_events e set valid=false from public.knockout_matches m
    where e.game_id=g.id and e.match_id=m.id and (m.player1 is distinct from e.player1 or m.player2 is distinct from e.player2);
  update public.games set tournament_revision=tournament_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'undo_knockout_result',p_input,jsonb_build_object('id',last_result.id::text));
end $$;

create or replace function public.create_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; gid uuid; game_format text;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'create_game',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if p_input->>'name' is null or length(trim(p_input->>'name')) not between 1 and 100 then raise exception 'Game name required (100 characters maximum)'; end if;
  if length(coalesce(p_input->>'details',''))>300 then raise exception 'Game details too long'; end if;
  game_format:=coalesce(p_input->>'format','teams');
  if game_format not in ('teams','ffa','knockout') then raise exception 'Choose a valid game format'; end if;
  insert into public.games(session_id,name,details,direction,format)
    values(sid,trim(p_input->>'name'),coalesce(p_input->>'details',''),case when game_format='knockout' then 'lower' else coalesce(p_input->>'direction','higher') end,game_format) returning id into gid;
  return scoreboard_private.finish(p_request_id,'create_game',p_input,jsonb_build_object('id',gid));
end $$;

create or replace function public.prepare_draw(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; ids uuid[]; count_teams integer; i integer; tid uuid; capacity integer:=2; seeds integer[]:=array[1,2]; expanded integer[]; seed integer; layout uuid[]:='{}'; r integer; n integer;
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

  delete from public.knockout_events where game_id=g.id;
  delete from public.knockout_matches where game_id=g.id;
  delete from scoreboard_private.knockout_draws where game_id=g.id;
  delete from public.teams where game_id=g.id;
  delete from public.game_participants where game_id=g.id;
  insert into public.game_participants(game_id,player_id,name,titles,image_path)
    select g.id,id,name,titles,image_path from public.players where id=any(ids);

  if g.format='knockout' then
    if exists(select 1 from public.games where session_id=sid and status='playing') then raise exception 'Finish the active game before drawing'; end if;
    -- Single-member award entries are independent of the private shuffled seed positions.
    for i in 1..cardinality(ids) loop
      insert into public.teams(game_id,position,name)
        select g.id,i-1,name from public.game_participants where game_id=g.id and player_id=ids[i] returning id into tid;
      insert into public.team_members(game_id,team_id,player_id,pick_index) values(g.id,tid,ids[i],i-1);
    end loop;
    select array_agg(value order by random()) into ids from unnest(ids) as chosen(value);
    while capacity<cardinality(ids) loop capacity:=capacity*2; end loop;
    while cardinality(seeds)<capacity loop
      expanded:='{}'; n:=cardinality(seeds)*2;
      foreach seed in array seeds loop expanded:=array_append(array_append(expanded,seed),n+1-seed); end loop;
      seeds:=expanded;
    end loop;
    foreach seed in array seeds loop layout:=array_append(layout,ids[seed]); end loop;
    insert into scoreboard_private.knockout_draws(game_id,layout) values(g.id,layout);
    r:=0; n:=capacity/2;
    while n>=1 loop
      for i in 0..n-1 loop
        insert into public.knockout_matches(game_id,round,position,published) values(g.id,r,i,r>0);
      end loop;
      n:=n/2; r:=r+1;
    end loop;
    delete from scoreboard_private.draws where game_id=g.id;
    update public.games set team_count=count_teams,total_players=cardinality(ids),pick_count=0,status='drafting',
      rolling=false,roll_started_at=null,draft_revision=draft_revision+1,tournament_revision=tournament_revision+1 where id=g.id;
  elsif g.format='ffa' then
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

create or replace function public.setup_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; sid uuid; gid uuid; g public.games; ids uuid[]; old_ids uuid[]; game_format text; count_teams integer;
  redraw boolean; output jsonb; input_name text; input_details text; input_direction text;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'setup_game',p_input); if cached is not null then return cached; end if;
  if p_input->>'session_id' is null then raise exception 'Select the active LAN'; end if;
  sid:=scoreboard_private.lock_session((p_input->>'session_id')::uuid);
  if exists(select 1 from public.games where session_id=sid and status='playing') then raise exception 'Finish the active game before starting another'; end if;
  input_name:=trim(coalesce(p_input->>'name','')); input_details:=coalesce(p_input->>'details','');
  input_direction:=coalesce(p_input->>'direction','higher'); game_format:=coalesce(p_input->>'format','teams');
  if game_format='knockout' then input_direction:='lower'; end if;
  if length(input_name) not between 1 and 100 then raise exception 'Enter a game name (100 characters maximum)'; end if;
  if length(input_details)>300 then raise exception 'Game details exceed 300 characters'; end if;
  if game_format not in ('teams','ffa','knockout') or input_direction not in ('higher','lower') then raise exception 'Choose a valid format and ranking'; end if;
  if jsonb_typeof(p_input->'player_ids') is distinct from 'array' then raise exception 'Select 2–64 different players'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_input->'player_ids');
  if ids is null or cardinality(ids) not between 2 and 64 then raise exception 'Select 2–64 different players'; end if;
  if (select count(distinct value) from unnest(ids) as chosen(value))<>cardinality(ids) then raise exception 'Duplicate or invalid player'; end if;
  if exists(select 1 from unnest(ids) as chosen(value) where not exists(select 1 from public.players p join public.session_players sp on sp.player_id=p.id and sp.session_id=sid where p.id=chosen.value and not p.archived)) then raise exception 'Choose active players from this LAN'; end if;
  count_teams:=case when game_format<>'teams' then cardinality(ids) else (p_input->>'team_count')::integer end;
  if game_format='teams' and (count_teams is null or count_teams not between 2 and 8 or count_teams>cardinality(ids)) then raise exception 'Select 2–8 nonempty teams'; end if;

  if p_input->>'game_id' is null then
    output:=public.create_game(p_input,gen_random_uuid()); gid:=(output->>'id')::uuid;
    select * into strict g from public.games where id=gid for update;
    redraw:=true;
  else
    select * into strict g from public.games where id=(p_input->>'game_id')::uuid and session_id=sid for update;
    gid:=g.id;
    if g.status not in ('setup','drafting','ready') then raise exception 'This game has already started'; end if;
    if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Game setup changed. Reload before editing.'; end if;
    select array_agg(player_id order by player_id) into old_ids from public.game_participants where game_id=gid;
    redraw:=g.total_players=0 or g.format<>game_format or (game_format='teams' and g.team_count<>count_teams) or ids is distinct from old_ids;
    if redraw and g.total_players>0 and not coalesce((p_input->>'confirm_redraw')::boolean,false) then raise exception 'Confirm replacing the existing assignments'; end if;
    if not redraw and g.rolling then raise exception 'Resume the pending pick before editing game setup'; end if;
    update public.games set name=input_name,details=input_details,format=game_format,direction=input_direction where id=gid;
  end if;
  if redraw then
    perform public.prepare_draw(jsonb_build_object('game_id',gid,'revision',g.draft_revision,'player_ids',p_input->'player_ids',
      'team_count',count_teams,'confirm_redraw',coalesce((p_input->>'confirm_redraw')::boolean,false)),gen_random_uuid());
  else
    update public.games set draft_revision=draft_revision+1 where id=gid;
  end if;
  select * into strict g from public.games where id=gid;
  if game_format='ffa' then
    perform public.start_game(jsonb_build_object('game_id',gid,'revision',g.draft_revision),gen_random_uuid());
    select * into strict g from public.games where id=gid;
  end if;
  return scoreboard_private.finish(p_request_id,'setup_game',p_input,jsonb_build_object('id',gid,'status',g.status));
end $$;

create or replace function public.start_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; item jsonb; team_id uuid; team_name text; seen uuid[]:='{}'; names text[]:='{}';
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'start_game',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status<>'ready' or g.total_players<2 or g.pick_count<>g.total_players then raise exception 'Finish assigning every player before starting'; end if;
  if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Game setup changed. Go back and review it before starting.'; end if;
  if exists(select 1 from public.games where session_id=sid and status='playing') then raise exception 'Finish the active game before starting another'; end if;
  if g.format='knockout' and (not exists(select 1 from public.knockout_matches where game_id=g.id)
    or exists(select 1 from public.knockout_matches where game_id=g.id and round=0 and not published)) then
    raise exception 'Finish revealing the tournament draw before starting';
  end if;
  if g.format='teams' then
    if jsonb_typeof(p_input->'teams') is distinct from 'array' then raise exception 'Name every team before starting'; end if;
    if jsonb_array_length(p_input->'teams')<>g.team_count then raise exception 'Name every team exactly once'; end if;
    for item in select value from jsonb_array_elements(p_input->'teams') loop
      team_id:=(item->>'id')::uuid;
      if team_id is null or team_id=any(seen) or not exists(select 1 from public.teams where id=team_id and game_id=g.id) then raise exception 'Invalid or duplicate team'; end if;
      team_name:=regexp_replace(coalesce(item->>'name',''),'^[[:space:]]+|[[:space:]]+$','','g');
      if length(team_name) not between 1 and 40 or team_name ~* '^team [a-h]$' then raise exception 'Give every team a name of 1–40 characters'; end if;
      if lower(team_name)=any(names) then raise exception 'Give each team a different name'; end if;
      seen:=array_append(seen,team_id); names:=array_append(names,lower(team_name));
      update public.teams set name=team_name where id=team_id;
    end loop;
  end if;
  update public.games set status='playing',draft_revision=draft_revision+1,tournament_revision=tournament_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'start_game',p_input,jsonb_build_object('id',g.id,'status','playing'));
end $$;

create or replace function public.save_result(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; eid uuid; item jsonb; t public.teams; member record;
  amount numeric; cents bigint; share bigint; remainder bigint; size integer; idx integer; award numeric; old numeric; seen uuid[]:='{}';
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'save_result',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.status not in ('playing','completed') or g.pick_count<>g.total_players or g.total_players=0 then raise exception 'Start the game before recording results'; end if;
  if g.format='knockout' then
    if p_input->>'tournament_revision' is null or g.tournament_revision<>(p_input->>'tournament_revision')::integer then
      raise exception 'Tournament changed. Reopen awards and review again.';
    end if;
    perform scoreboard_private.knockout_place(g.id,(select player_id from public.game_participants where game_id=g.id limit 1));
  end if;
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
    if g.format='knockout' and (
      item->>'mode' is distinct from 'equal' or
      scoreboard_private.points(item->>'result')<>scoreboard_private.knockout_place(g.id,(select player_id from public.team_members where team_id=t.id))
    ) then raise exception 'Use the bracket finishing place and individual player points'; end if;
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

create or replace function public.read_board(p_session_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
      'knockout_matches',coalesce((select jsonb_agg(to_jsonb(k) order by k.round,k.position) from public.knockout_matches k where k.game_id=g.id),'[]'),
      'knockout_events',coalesce((select jsonb_agg(to_jsonb(k)||jsonb_build_object('id',k.id::text) order by k.id) from public.knockout_events k where k.game_id=g.id),'[]'),
      'knockout_last_result',case when public.is_admin() then (select k.id::text from scoreboard_private.knockout_results k where k.game_id=g.id and k.reversed_at is null order by k.id desc limit 1) else null end,
      'knockout_history',case when public.is_admin() then coalesce((select jsonb_agg(to_jsonb(k)||jsonb_build_object('id',k.id::text) order by k.id) from scoreboard_private.knockout_results k where k.game_id=g.id),'[]') else '[]'::jsonb end,
      'awards',coalesce((select jsonb_agg(to_jsonb(a)) from public.game_awards a where a.game_id=g.id),'[]')) order by g.created_at desc) from public.games g where g.session_id=s.id),'[]'),
    'roster',case when public.is_admin() then coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.players p),'[]') else '[]'::jsonb end,
    'sessions',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at desc) from public.lan_sessions l where l.active or public.is_admin()),'[]'),
    'events',case when public.is_admin() then coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.score_allocations a where a.event_id=e.id),'[]')) order by e.created_at desc) from public.score_events e where e.session_id=s.id),'[]') else '[]'::jsonb end
  ) into output;
  return output;
end $$;

create or replace function public.begin_roll(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.draws; sid uuid; output jsonb;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'begin_roll',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.format<>'teams' then raise exception 'This operation is only for team assignment'; end if;
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

create or replace function public.commit_roll(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; d scoreboard_private.draws; sid uuid; tid uuid;
begin
  perform scoreboard_private.require_admin(); cached:=scoreboard_private.cached(p_request_id,'commit_roll',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.format<>'teams' then raise exception 'This operation is only for team assignment'; end if;
  select * into strict d from scoreboard_private.draws where game_id=g.id for update;
  if d.pending_id is null or p_input->>'roll_id' is null or d.pending_id<>(p_input->>'roll_id')::uuid or p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Pick changed or already committed. Refresh the draft.'; end if;
  select id into strict tid from public.teams where game_id=g.id and position=g.pick_count%g.team_count;
  insert into public.team_members(game_id,team_id,player_id,pick_index) values(g.id,tid,d.pending_player,g.pick_count);
  update scoreboard_private.draws set pending_id=null,pending_player=null,pending_revision=null where game_id=g.id;
  update public.games set pick_count=pick_count+1,draft_revision=draft_revision+1,rolling=false,roll_started_at=null,
    status=case when pick_count+1=total_players then 'ready' else 'drafting' end where id=g.id;
  return scoreboard_private.finish(p_request_id,'commit_roll',p_input,jsonb_build_object('player_id',d.pending_player,'team_id',tid));
end $$;

revoke all on all functions in schema scoreboard_private from public,anon,authenticated;
revoke all on function public.begin_knockout_reveal(jsonb,uuid),public.commit_knockout_reveal(jsonb,uuid),
  public.record_knockout_winner(jsonb,uuid),public.undo_knockout_result(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.begin_knockout_reveal(jsonb,uuid),public.commit_knockout_reveal(jsonb,uuid),
  public.record_knockout_winner(jsonb,uuid),public.undo_knockout_result(jsonb,uuid) to authenticated;
commit;
