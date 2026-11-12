begin;

alter table public.games add column mvp_player_id uuid;
alter table public.games add constraint games_mvp_participant
  foreign key (id,mvp_player_id) references public.game_participants(game_id,player_id);
alter table public.games add constraint games_mvp_completed
  check (mvp_player_id is null or status='completed');

-- read_board already serializes to_jsonb(g), so the nullable MVP is included
-- under the existing session visibility and saved participant identity rules.
-- Save MVP and points together, retaining the existing result transaction,
-- revisions, deduplication, and award-correction semantics.
create or replace function public.save_result(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; eid uuid; item jsonb; t public.teams; member record; mvp uuid;
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
  if p_input->>'board_revision' is null or (select revision from public.board_updates where id=1)<>(p_input->>'board_revision')::bigint then raise exception 'Scores changed. Refresh and reopen results to review before saving.'; end if;
  if g.score_revision>0 and length(trim(coalesce(p_input->>'reason','')))=0 then raise exception 'A correction needs a reason'; end if;
  if length(coalesce(p_input->>'reason',''))>500 then raise exception 'Reason exceeds 500 characters'; end if;
  if jsonb_typeof(p_input->'teams') is distinct from 'array' or jsonb_array_length(p_input->'teams')<>g.team_count then raise exception 'Provide every team exactly once'; end if;

  -- An omitted field preserves an existing MVP for older clients; explicit
  -- null/empty clears it. A chosen MVP must belong to this game's saved roster.
  mvp:=case when p_input ? 'mvp_player_id' then nullif(p_input->>'mvp_player_id','')::uuid else g.mvp_player_id end;
  if mvp is not null and not exists(select 1 from public.game_participants where game_id=g.id and player_id=mvp) then
    raise exception 'Choose an MVP from this game''s participants';
  end if;

  insert into public.score_events(session_id,game_id,kind,reason,payload,actor)
    values(
      sid,g.id,
      case when g.score_revision=0 then 'result' else 'correction' end,
      coalesce(nullif(trim(p_input->>'reason'),''),g.name),
      p_input,auth.uid()
    ) returning id into eid;
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
  update public.games set status='completed',score_revision=score_revision+1,mvp_player_id=mvp where id=g.id;
  return scoreboard_private.finish(p_request_id,'save_result',p_input,jsonb_build_object('id',eid));
end $$;

revoke all on function public.save_result(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_result(jsonb,uuid) to authenticated;

commit;
