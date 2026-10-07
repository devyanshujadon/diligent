-- Diligent schema. Run in the Supabase SQL editor.
-- Requires pgvector (enabled on Supabase) for finding embeddings.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text,
  created_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  status text not null check (
    status in (
      'queued',
      'planning',
      'researching',
      'critiquing',
      'retrying',
      'writing',
      'completed',
      'failed'
    )
  ),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists agent_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  agent text not null,
  type text not null,
  message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists agent_events_run_created_idx
  on agent_events (run_id, created_at);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs (id) on delete cascade,
  agent text not null,
  claim text not null,
  evidence_quote text,
  source_url text,
  confidence double precision,
  status text not null check (status in ('accepted', 'rejected')),
  reject_reason text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists findings_run_idx on findings (run_id);
create index if not exists findings_embedding_idx
  on findings using hnsw (embedding vector_cosine_ops);

create table if not exists memos (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references runs (id) on delete cascade,
  markdown text not null,
  verdict text,
  confidence double precision
);

-- Memory lookup. Similarity is cosine distance via the <=> operator.
create or replace function match_findings (
  query_embedding vector(1536),
  match_count int default 6,
  match_threshold float default 0.55
)
returns table (
  id uuid,
  run_id uuid,
  agent text,
  claim text,
  evidence_quote text,
  source_url text,
  confidence double precision,
  similarity float
)
language sql
stable
as $$
  select
    f.id,
    f.run_id,
    f.agent,
    f.claim,
    f.evidence_quote,
    f.source_url,
    f.confidence,
    (1 - (f.embedding <=> query_embedding))::float as similarity
  from findings f
  where f.status = 'accepted'
    and f.embedding is not null
    and (1 - (f.embedding <=> query_embedding)) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

alter table companies enable row level security;
alter table runs enable row level security;
alter table agent_events enable row level security;
alter table findings enable row level security;
alter table memos enable row level security;

-- Hackathon demo: the browser never holds a key. The server uses the
-- service role (bypasses RLS) or the anon key. Anon may read and write
-- so a judge can paste either key. Do not ship this policy to production.
do $$
declare
  t text;
begin
  foreach t in array array['companies', 'runs', 'agent_events', 'findings', 'memos']
  loop
    execute format('drop policy if exists diligent_read on %I', t);
    execute format('drop policy if exists diligent_write on %I', t);
    execute format('drop policy if exists diligent_update on %I', t);
    execute format('create policy diligent_read on %I for select using (true)', t);
    execute format('create policy diligent_write on %I for insert with check (true)', t);
    execute format('create policy diligent_update on %I for update using (true) with check (true)', t);
  end loop;
end $$;

grant select, insert, update on companies, runs, agent_events, findings, memos
  to anon, authenticated, service_role;
grant execute on function match_findings(vector(1536), int, float)
  to anon, authenticated, service_role;
