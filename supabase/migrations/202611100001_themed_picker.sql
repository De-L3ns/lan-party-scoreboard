begin;

alter table public.games add column picker_mode text not null default 'rifle'
  check(picker_mode in ('rifle','trackmania'));

create function public.set_picker_mode(p_input jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare cached jsonb; g public.games; sid uuid; chosen_mode text;
begin
  perform scoreboard_private.require_admin();
  cached:=scoreboard_private.cached(p_request_id,'set_picker_mode',p_input); if cached is not null then return cached; end if;
  select session_id into sid from public.games where id=(p_input->>'game_id')::uuid;
  if sid is null then raise exception 'Select a game'; end if;
  perform scoreboard_private.lock_session(sid);
  select * into strict g from public.games where id=(p_input->>'game_id')::uuid for update;
  if g.format<>'teams' or g.status<>'drafting' or g.pick_count>=g.total_players then raise exception 'Choose a picker mode during team assignment'; end if;
  if g.rolling or exists(select 1 from scoreboard_private.draws where game_id=g.id and pending_id is not null) then raise exception 'Finish or resume the pending pick before changing mode'; end if;
  if p_input->>'revision' is null or g.draft_revision<>(p_input->>'revision')::integer then raise exception 'Draft changed. Refresh before changing mode.'; end if;
  chosen_mode:=p_input->>'picker_mode';
  if chosen_mode is null or chosen_mode not in ('rifle','trackmania') then raise exception 'Choose Call of Duty 2 or TrackMania'; end if;
  if chosen_mode<>g.picker_mode then
    update public.games set picker_mode=chosen_mode,draft_revision=draft_revision+1 where id=g.id;
  end if;
  return scoreboard_private.finish(p_request_id,'set_picker_mode',p_input,jsonb_build_object('id',g.id,'picker_mode',chosen_mode));
end $$;

revoke all on function public.set_picker_mode(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.set_picker_mode(jsonb,uuid) to authenticated;

-- read_board already serializes games with to_jsonb; no private draw data is added.
commit;
