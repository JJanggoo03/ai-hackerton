CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS github_links (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 github_id bigint NOT NULL, login text NOT NULL, credentials text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS archive_nodes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 path text NOT NULL, kind text NOT NULL CHECK(kind IN ('folder','file')),
 hash text, bytes integer NOT NULL DEFAULT 0, mime text, date bigint NOT NULL,
 PRIMARY KEY(user_id,path)
);
CREATE TABLE IF NOT EXISTS destinations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope text NOT NULL, repo_id bigint NOT NULL, installation_id bigint NOT NULL,
 full_name text NOT NULL, branch text NOT NULL,
 PRIMARY KEY(user_id,scope)
);
CREATE TABLE IF NOT EXISTS transfers (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan jsonb NOT NULL, state text NOT NULL DEFAULT 'ready', result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assistant_conversations (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36) NOT NULL, messages TEXT NOT NULL, state TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
