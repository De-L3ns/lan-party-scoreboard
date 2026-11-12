-- Manual acceptance script; run as database owner AFTER all migrations.
-- Requires an enrolled organizer and a disposable active TEST - ... LAN
-- with no active game. ROLLBACK retains no test players, games, or scores.
begin;

do $test$
declare
  organizer uuid; sid uuid; pid uuid; chosen uuid[]:='{}'; gid uuid;
  rid uuid; result jsonb; payload jsonb; awards jsonb; snapshot jsonb;
  i integer; denied boolean; revision_before integer; event_count bigint;
begin
  select user_id into organizer from public.admin_users limit 1;
  if organizer is null then raise exception 'Enroll an organizer first'; end if;
  select id into sid from public.lan_sessions where active and name like 'TEST - %';
  if sid is null or exists(select 1 from public.games where session_id=sid and status='playing') then
    raise exception 'Use a disposable active TEST - ... LAN with no active game';
  end if;
  perform set_config('request.jwt.claim.sub',organizer::text,true);
  if not public.is_admin() then raise exception 'Organizer identity not established'; end if;
  if has_function_privilege('anon','public.save_result(jsonb,uuid)','execute')
    or has_table_privilege('authenticated','public.games','update') then
    raise exception 'Result grants allow unauthorized mutation';
  end if;

  for i in 1..3 loop
    insert into public.players(name,titles) values('Test MVP '||i,array['Saved title']) returning id into pid;
    insert into public.session_players(session_id,player_id,name,titles)
      values(sid,pid,'Test MVP '||i,array['Saved title']);
    chosen:=array_append(chosen,pid);
  end loop;
  result:=public.setup_game(jsonb_build_object('session_id',sid,'name','MVP acceptance','format','ffa',
    'player_ids',to_jsonb(chosen[1:2])),gen_random_uuid());
  gid:=(result->>'id')::uuid;
  select jsonb_agg(jsonb_build_object('id',id,'result','1','mode','equal','amount','5') order by position)
    into awards from public.teams where game_id=gid;
  payload:=jsonb_build_object('game_id',gid,'revision',0,
    'board_revision',(select revision from public.board_updates where id=1),'teams',awards,'mvp_player_id',null);
  perform public.save_result(payload,gen_random_uuid());
  if (select mvp_player_id from public.games where id=gid) is not null then raise exception 'Optional MVP was assigned'; end if;

  -- Select, preserve for an older client, change, and explicitly clear.
  for i in 1..4 loop
    select score_revision into revision_before from public.games where id=gid;
    select count(*) into event_count from public.score_events where game_id=gid;
    payload:=jsonb_build_object('game_id',gid,'revision',revision_before,
      'board_revision',(select revision from public.board_updates where id=1),'teams',awards,'reason','MVP correction');
    if i<>2 then payload:=payload||jsonb_build_object('mvp_player_id',case when i=1 then chosen[1] when i=3 then chosen[2] else null end); end if;

    -- Non-admin callers, foreign participants, stale forms, and missing reasons
    -- must fail before points or the saved MVP can change.
    if i=1 then
      perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
      denied:=false;
      begin perform public.save_result(payload,gen_random_uuid());
      exception when insufficient_privilege then denied:=true; end;
      if not denied then raise exception 'Non-admin result accepted'; end if;
      perform set_config('request.jwt.claim.sub',organizer::text,true);
      denied:=false;
      begin perform public.save_result(payload||jsonb_build_object('mvp_player_id',chosen[3]),gen_random_uuid());
      exception when raise_exception then
        if sqlerrm not like 'Choose an MVP%' then raise; end if; denied:=true;
      end;
      if not denied then raise exception 'Nonparticipant MVP accepted'; end if;
      denied:=false;
      begin perform public.save_result(payload||jsonb_build_object('revision',revision_before-1),gen_random_uuid());
      exception when raise_exception then
        if sqlerrm not like 'Result changed.%' then raise; end if; denied:=true;
      end;
      if not denied then raise exception 'Stale MVP correction accepted'; end if;
      denied:=false;
      begin perform public.save_result(payload-'reason',gen_random_uuid());
      exception when raise_exception then
        if sqlerrm not like 'A correction needs a reason%' then raise; end if; denied:=true;
      end;
      if not denied then raise exception 'Unreasoned MVP correction accepted'; end if;
      if (select count(*) from public.score_events where game_id=gid)<>event_count
        or (select mvp_player_id from public.games where id=gid) is not null then
        raise exception 'Failed request changed result state';
      end if;
    end if;

    rid:=gen_random_uuid(); result:=public.save_result(payload,rid);
    if public.save_result(payload,rid)<>result
      or (select score_revision from public.games where id=gid)<>revision_before+1
      or (select count(*) from public.score_events where game_id=gid)<>event_count+1 then
      raise exception 'Result retry changed or duplicated an award';
    end if;
    if (select mvp_player_id from public.games where id=gid) is distinct from
      (case when i in (1,2) then chosen[1] when i=3 then chosen[2] else null end) then
      raise exception 'MVP select/preserve/change/clear failed at step %',i;
    end if;
    if (select e.payload from public.score_events e where e.id=(result->>'id')::uuid) is distinct from payload then
      raise exception 'MVP correction payload not audited';
    end if;
    if (select sum(a.points) from public.score_allocations a join public.score_events e on e.id=a.event_id where e.game_id=gid)<>10
      or (select sum(points) from public.game_awards where game_id=gid)<>10 then
      raise exception 'MVP added points or corrections duplicated awards';
    end if;
    select value into snapshot from jsonb_array_elements(public.read_board(sid)->'games') where value->>'id'=gid::text;
    if snapshot is null or not (snapshot ? 'mvp_player_id') or snapshot->>'mvp_player_id' is distinct from
      (case when i in (1,2) then chosen[1]::text when i=3 then chosen[2]::text else null end) then
      raise exception 'Board snapshot omitted or changed the MVP';
    end if;
  end loop;
end $test$;

rollback;
