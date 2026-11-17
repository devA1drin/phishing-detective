-- Phase 2: realism (additive; no data is dropped)
-- vishing scenarios use channel 'call' (constraint widened, rows untouched)
alter table scenarios drop constraint if exists scenarios_channel_check;
alter table scenarios add constraint scenarios_channel_check check (channel in ('email','sms','social','call'));
alter table scenarios add column if not exists language text not null default 'en';
alter table scenarios drop constraint if exists scenarios_language_check;
alter table scenarios add constraint scenarios_language_check check (language in ('en','tl','taglish'));
-- existing seed scenarios written in Taglish
update scenarios set language = 'taglish'
  where id in ('shopee-prize-sms','messenger-friend-vote','job-sms-easy-money','messenger-gcash-loan','lazada-refund-chat') and language = 'en';

-- round mode (classic one-by-one, inbox sorting) and the language filter used
alter table game_sessions add column if not exists mode text not null default 'classic';
alter table game_sessions add column if not exists language text;
-- link trap: did the player open a link in this case?
alter table answers add column if not exists link_clicked boolean not null default false;
create index if not exists idx_scenarios_language on scenarios(language);
