-- Manual transactional acceptance script, not a local database harness.
-- Run as database owner AFTER all migrations, against a disposable project/LAN.
-- Requires an enrolled organizer and an active LAN named TEST - ... with no active game.
-- Success ends with ROLLBACK: no test players, games, awards, or requests are retained.
begin;
do $test$
declare
  organizer uuid; sid uuid; chosen uuid[]:='{}'; pid uuid; gid uuid; rid uuid;
  n integer; i integer; capacity integer; payload jsonb; reservation jsonb; result jsonb;
  g public.games; m public.knockout_matches; final public.knockout_matches;
  last_id bigint; denied boolean; revision_before integer; awards jsonb; played integer;
begin
  select user_id into organizer from public.admin_users limit 1;
  if organizer is null then raise exception 'Enroll an organizer before running acceptance checks'; end if;
  select id into sid from public.lan_sessions where active and name like 'TEST - %';
  if sid is null or exists(select 1 from public.games where session_id=sid and status='playing') then
    raise exception 'Use a disposable active LAN named TEST - ... with no active game';
  end if;
  perform set_config('request.jwt.claim.sub',organizer::text,true);
  if not public.is_admin() then raise exception 'Organizer test identity not established'; end if;
  if has_function_privilege('anon','public.record_knockout_winner(jsonb,uuid)','execute')
    or has_function_privilege('anon','public.begin_knockout_reveal(jsonb,uuid)','execute')
    or has_table_privilege('authenticated','scoreboard_private.knockout_draws','select')
    or has_table_privilege('anon','scoreboard_private.knockout_results','select')
    or has_table_privilege('authenticated','public.knockout_matches','update') then
    raise exception 'Tournament grants expose private data or direct mutation';
  end if;
  for i in 1..64 loop
    insert into public.players(name,titles) values('Test fighter '||i,array['Test tag']) returning id into pid;
    insert into public.session_players(session_id,player_id,name,titles)
      values(sid,pid,'Test fighter '||i,array['Test tag']);
    chosen:=array_append(chosen,pid);
  end loop;

  foreach n in array array[2,3,5,8,12,16,32,63,64] loop
    result:=public.setup_game(jsonb_build_object('session_id',sid,'name','Acceptance '||n,'format','knockout','player_ids',to_jsonb(chosen[1:n])),gen_random_uuid());
    gid:=(result->>'id')::uuid;
    select * into strict g from public.games where id=gid;
    capacity:=2; while capacity<n loop capacity:=capacity*2; end loop;
    if g.direction<>'lower' or g.team_count<>n or g.pick_count<>0 or g.status<>'drafting' then raise exception 'Invalid knockout setup'; end if;
    if (select count(*) from public.knockout_matches where game_id=gid)<>capacity-1 then raise exception 'Incorrect bracket size for %',n; end if;
    if exists(select 1 from public.knockout_matches where game_id=gid and (player1 is not null or player2 is not null)) then raise exception 'Seed positions published before reveal'; end if;
    if exists(select 1 from public.teams where game_id=gid and result is not null) then raise exception 'Premature finishing places'; end if;

    -- A signed-in non-admin must still fail an authorized RPC, even as a direct call.
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    denied:=false;
    begin
      perform public.begin_knockout_reveal(jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision),gen_random_uuid());
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Non-admin draw was accepted'; end if;
    if (public.read_board(sid)->>'is_admin')::boolean then raise exception 'Public snapshot leaked organizer state'; end if;
    perform set_config('request.jwt.claim.sub',organizer::text,true);

    for i in 0..capacity/2-1 loop
      select * into strict g from public.games where id=gid;
      payload:=jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision);
      rid:=gen_random_uuid(); reservation:=public.begin_knockout_reveal(payload,rid);
      if public.begin_knockout_reveal(payload,rid)<>reservation then raise exception 'Reservation retry changed'; end if;
      payload:=jsonb_build_object('game_id',gid,'reveal_id',reservation->>'id','tournament_revision',reservation->'tournament_revision');
      rid:=gen_random_uuid(); result:=public.commit_knockout_reveal(payload,rid);
      revision_before:=(select tournament_revision from public.games where id=gid);
      if public.commit_knockout_reveal(payload,rid)<>result
        or (select tournament_revision from public.games where id=gid)<>revision_before then raise exception 'Commit retry duplicated a reveal'; end if;
    end loop;
    select * into strict g from public.games where id=gid;
    if g.status<>'ready' or g.pick_count<>n then raise exception 'Opening draw did not finish'; end if;
    if (select count(*) from public.knockout_matches where game_id=gid and status='bye')<>capacity-n then raise exception 'Incorrect byes'; end if;
    if exists(select 1 from public.knockout_matches where game_id=gid and round=0 and player1 is null and player2 is null) then raise exception 'Bye versus bye'; end if;
    if (select count(distinct id) from (select player1 id from public.knockout_matches where game_id=gid and round=0 union all select player2 from public.knockout_matches where game_id=gid and round=0) x)<>n then raise exception 'Missing or duplicate seeded player'; end if;
    perform public.start_game(jsonb_build_object('game_id',gid,'revision',g.draft_revision),gen_random_uuid());

    denied:=false;
    begin
      perform public.setup_game(jsonb_build_object('session_id',sid,'name','Competing game','format','ffa','player_ids',to_jsonb(chosen[1:2])),gen_random_uuid());
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'A second game started while the tournament was active'; end if;

    -- Record, retry, and undo a real match. Undo also covers a decided two-player final.
    select * into strict m from public.knockout_matches where game_id=gid and status='ready' order by round,position limit 1;
    select * into strict g from public.games where id=gid;
    payload:=jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision,'match_id',m.id,'winner_id',m.player1);
    rid:=gen_random_uuid(); result:=public.record_knockout_winner(payload,rid);
    last_id:=(result->>'result_id')::bigint;
    if public.record_knockout_winner(payload,rid)<>result then raise exception 'Winner retry changed'; end if;
    denied:=false;
    begin perform public.record_knockout_winner(payload||jsonb_build_object('winner_id',m.player2),gen_random_uuid());
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'Stale competing winner accepted'; end if;
    select * into strict g from public.games where id=gid;
    perform public.undo_knockout_result(jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision,'result_id',last_id::text,'confirmed',true),gen_random_uuid());
    if not exists(select 1 from scoreboard_private.knockout_results where id=last_id and reversed_at is not null and reversed_by=organizer) then raise exception 'Undo erased or failed to audit the original'; end if;
    if (select winner_id from public.knockout_matches where id=m.id) is not null then raise exception 'Undo retained the winner'; end if;
    if exists(select 1 from public.knockout_events e join public.knockout_matches k on k.id=e.match_id where e.game_id=gid and e.valid and (k.player1 is distinct from e.player1 or k.player2 is distinct from e.player2)) then raise exception 'Undo retained an invalid pairing event'; end if;

    played:=0;
    loop
      select * into strict final from public.knockout_matches where game_id=gid order by round desc limit 1;
      exit when final.status='complete';
      select * into strict m from public.knockout_matches where game_id=gid and status='ready' order by round,position limit 1;
      select * into strict g from public.games where id=gid;
      perform public.record_knockout_winner(jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision,'match_id',m.id,'winner_id',m.player1),gen_random_uuid());
      played:=played+1;
      if played>=n then raise exception 'Bracket did not converge'; end if;
    end loop;
    if played<>n-1 or (select count(*) from public.knockout_matches where game_id=gid and status='complete')<>n-1 then raise exception 'Incorrect played-match count'; end if;
    if exists(select 1 from public.game_awards where game_id=gid) then raise exception 'Match wins awarded leaderboard points'; end if;
    if n=8 and (select count(*) from public.game_participants p where p.game_id=gid and scoreboard_private.knockout_place(gid,p.player_id)=5)<>4 then raise exception 'Quarterfinal losers do not tie fifth'; end if;

    select * into strict g from public.games where id=gid;
    select jsonb_agg(jsonb_build_object('id',t.id,'result',scoreboard_private.knockout_place(gid,members.player_id),'mode','equal','amount','1.25')) into awards
      from public.teams t join public.team_members members on members.team_id=t.id where t.game_id=gid;
    payload:=jsonb_build_object('game_id',gid,'revision',g.score_revision,'tournament_revision',g.tournament_revision,'board_revision',(select revision from public.board_updates where id=1),'teams',awards);
    denied:=false;
    begin perform public.save_result(jsonb_set(payload,'{teams,0,result}','99'),gen_random_uuid());
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'Forged placement was accepted'; end if;
    rid:=gen_random_uuid(); result:=public.save_result(payload,rid);
    if public.save_result(payload,rid)<>result then raise exception 'Award retry changed'; end if;
    if (select sum(points) from public.game_awards where game_id=gid)<>n*1.25 then raise exception 'Wrong initial awards'; end if;

    -- Completed brackets are immutable; points retain the existing difference-only correction model.
    select * into strict g from public.games where id=gid;
    denied:=false;
    begin perform public.undo_knockout_result(jsonb_build_object('game_id',gid,'tournament_revision',g.tournament_revision,'result_id',last_id::text,'confirmed',true),gen_random_uuid());
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'Completed bracket was editable'; end if;
    select jsonb_agg(value||jsonb_build_object('amount','2.50')) into awards from jsonb_array_elements(awards);
    payload:=jsonb_build_object('game_id',gid,'revision',g.score_revision,'tournament_revision',g.tournament_revision,'board_revision',(select revision from public.board_updates where id=1),'teams',awards,'reason','Acceptance correction');
    perform public.save_result(payload,gen_random_uuid());
    if (select sum(a.points) from public.score_allocations a join public.score_events e on e.id=a.event_id where e.game_id=gid)<>n*2.5 then raise exception 'Correction duplicated awards'; end if;
    raise notice '%-player tournament passed draw, byes, retry, undo, champion, awards, and correction checks',n;
  end loop;
end $test$;
rollback;
