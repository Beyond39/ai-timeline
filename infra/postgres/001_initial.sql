-- Planning baseline; refine types, RLS and indexes before production.
create table workspaces (
  id uuid primary key,
  name text not null,
  retention_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  title text not null,
  goal text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  provider text not null,
  source_type text not null,
  external_id text,
  content_sha256 char(64) not null,
  object_key text not null,
  imported_at timestamptz not null default now(),
  unique (workspace_id, content_sha256)
);

create table conversations (
  id uuid primary key,
  project_id uuid references projects(id),
  source_id uuid not null references sources(id),
  external_id text,
  title text,
  started_at timestamptz
);

create table messages (
  id uuid primary key,
  conversation_id uuid not null references conversations(id),
  parent_id uuid references messages(id),
  ordinal bigint not null,
  role text not null,
  content jsonb not null,
  source_locator jsonb not null,
  occurred_at timestamptz,
  unique (conversation_id, ordinal)
);

create table analysis_runs (
  id uuid primary key,
  project_id uuid not null references projects(id),
  stage text not null,
  pipeline_version text not null,
  prompt_version text not null,
  schema_version text not null,
  provider text not null,
  model text not null,
  input_hash char(64) not null,
  status text not null,
  usage jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, stage, pipeline_version, input_hash)
);

create table knowledge_nodes (
  id uuid primary key,
  project_id uuid not null references projects(id),
  kind text not null,
  parent_id uuid references knowledge_nodes(id),
  state text not null,
  title text not null,
  body jsonb not null,
  analysis_run_id uuid references analysis_runs(id),
  confidence numeric(4,3),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table evidence_links (
  node_id uuid not null references knowledge_nodes(id),
  message_id uuid not null references messages(id),
  locator jsonb not null,
  quote_hash char(64),
  primary key (node_id, message_id, quote_hash)
);

create table knowledge_edges (
  id uuid primary key,
  project_id uuid not null references projects(id),
  from_node_id uuid not null references knowledge_nodes(id),
  edge_type text not null,
  to_node_id uuid not null references knowledge_nodes(id),
  analysis_run_id uuid references analysis_runs(id),
  confidence numeric(4,3),
  created_at timestamptz not null default now()
);

create table domain_events (
  id uuid primary key,
  project_id uuid not null references projects(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  occurred_at timestamptz not null,
  actor jsonb not null,
  payload jsonb not null,
  sequence bigint not null,
  unique (aggregate_type, aggregate_id, sequence)
);

create index messages_conversation_time_idx on messages(conversation_id, occurred_at);
create index knowledge_nodes_project_kind_idx on knowledge_nodes(project_id, kind, state);
create index domain_events_project_time_idx on domain_events(project_id, occurred_at, id);

