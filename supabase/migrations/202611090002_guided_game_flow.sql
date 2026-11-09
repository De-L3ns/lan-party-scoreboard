begin;

-- Every start locks the active LAN row before checking for an existing game.
-- This serializes competing starts without rewriting historical games.

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
  update public.games set status='playing',draft_revision=draft_revision+1 where id=g.id;
  return scoreboard_private.finish(p_request_id,'start_game',p_input,jsonb_build_object('id',g.id,'status','playing'));
end $$;

-- Save player selection and game details together. Free-for-all starts in the
-- same transaction; team games return their existing or newly prepared draft.
create function public.setup_game(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if length(input_name) not between 1 and 100 then raise exception 'Enter a game name (100 characters maximum)'; end if;
  if length(input_details)>300 then raise exception 'Game details exceed 300 characters'; end if;
  if game_format not in ('teams','ffa') or input_direction not in ('higher','lower') then raise exception 'Choose a valid format and ranking'; end if;
  if jsonb_typeof(p_input->'player_ids') is distinct from 'array' then raise exception 'Select 2–64 different players'; end if;
  select array_agg(value::uuid order by value::uuid) into ids from jsonb_array_elements_text(p_input->'player_ids');
  if ids is null or cardinality(ids) not between 2 and 64 then raise exception 'Select 2–64 different players'; end if;
  if (select count(distinct value) from unnest(ids) as chosen(value))<>cardinality(ids) then raise exception 'Duplicate or invalid player'; end if;
  if exists(select 1 from unnest(ids) as chosen(value) where not exists(select 1 from public.players p join public.session_players sp on sp.player_id=p.id and sp.session_id=sid where p.id=chosen.value and not p.archived)) then raise exception 'Choose active players from this LAN'; end if;
  count_teams:=case when game_format='ffa' then cardinality(ids) else (p_input->>'team_count')::integer end;
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

revoke all on function public.setup_game(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.setup_game(jsonb,uuid) to authenticated;

-- Result entry requires a started game. Existing corrections remain supported.
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


commit;
