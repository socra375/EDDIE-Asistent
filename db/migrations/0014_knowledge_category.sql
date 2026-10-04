-- The kind of each thing Eddie learned (empresarial, cotidiana, personal, única…),
-- picked by the AI when it learns the topic and changeable by the user. It gives
-- the colour on the second brain's map. Additive: existing topics become "unica".
alter table knowledge_topics add column if not exists category text not null default 'unica';
