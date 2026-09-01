-- ============================================================================
-- 0057 — only the DM may resize a token (9.1.2f)
--
-- Owner decision: a player may MOVE their own token but not change how big it
-- is. Size is a fact about the creature, which is the DM's to set; movement is
-- the player's to choose. 0056 let size ride along with the existing update
-- policy, and that was too generous.
--
-- WHY A TRIGGER AND NOT A POLICY. This is a "column may not change" rule, and a
-- `with check` clause cannot express one: it is evaluated AFTER the row is
-- updated, so a function reading the row back sees the NEW value and the test
-- reduces to `size_cells = size_cells`. That is not a guess — it is exactly the
-- bug that shipped in 0052 and was caught by the matrix in 0053. A BEFORE UPDATE
-- trigger is handed OLD and NEW and can compare them, so the rule goes there.
--
-- The DM keeps full control, including over a token a player owns: the DM is the
-- one deciding that the ogre is three squares across.
-- ============================================================================

create or replace function private.forbid_player_token_resize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.size_cells is distinct from old.size_cells
     and not private.is_campaign_dm(private.playspace_map_campaign(new.map_id)) then
    raise exception 'only the DM may change a token''s size'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function private.forbid_player_token_resize() is
  'Blocks a non-DM from changing playspace_tokens.size_cells. A trigger rather than a policy because WITH CHECK cannot see a row''s previous value — see migrations 0053 and 0057.';

drop trigger if exists playspace_tokens_forbid_player_resize on public.playspace_tokens;
create trigger playspace_tokens_forbid_player_resize
  before update on public.playspace_tokens
  for each row
  execute function private.forbid_player_token_resize();
