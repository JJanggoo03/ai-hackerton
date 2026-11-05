CREATE TABLE IF NOT EXISTS users (
 id CHAR(36) PRIMARY KEY, name VARCHAR(255) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS github_links (
 user_id CHAR(36) PRIMARY KEY, github_id BIGINT NOT NULL,
 login VARCHAR(255) NOT NULL, credentials TEXT NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY github_links_github_id_uq (github_id),
 CONSTRAINT github_links_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS archive_nodes (
 user_id CHAR(36) NOT NULL, path VARCHAR(700) NOT NULL,
 kind VARCHAR(16) NOT NULL, hash CHAR(64), bytes INT NOT NULL DEFAULT 0,
 mime VARCHAR(255), date BIGINT NOT NULL,
 PRIMARY KEY(user_id,path),
 CONSTRAINT archive_nodes_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT archive_nodes_kind_ck CHECK(kind IN ('folder','file'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS destinations (
 user_id CHAR(36) NOT NULL, scope VARCHAR(700) NOT NULL,
 repo_id BIGINT NOT NULL, installation_id BIGINT NOT NULL,
 full_name VARCHAR(255) NOT NULL, branch VARCHAR(255) NOT NULL,
 PRIMARY KEY(user_id,scope),
 CONSTRAINT destinations_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS transfers (
 id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, plan JSON NOT NULL,
 state VARCHAR(20) NOT NULL DEFAULT 'ready', result JSON,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT transfers_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX transfers_user_state_idx(user_id,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS sessions (
 sid VARCHAR(128) PRIMARY KEY, expires TIMESTAMP(3) NOT NULL, sess JSON NOT NULL,
 INDEX sessions_expires_idx(expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assistant_conversations (id VARCHAR(36) PRIMARY KEY, owner_id VARCHAR(36) NOT NULL, messages LONGTEXT NOT NULL, state LONGTEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
