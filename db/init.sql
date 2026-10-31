CREATE TABLE users (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 username VARCHAR(64) NOT NULL UNIQUE,
 password_hash VARCHAR(256) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY,
 user_id BIGINT NOT NULL,
 expires_at DATETIME NOT NULL,
 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE conversations (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 pair_key VARCHAR(64) UNIQUE NOT NULL,
 sequence BIGINT NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE members (
 conversation_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 PRIMARY KEY (conversation_id,user_id),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id),
 FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE files (
 id CHAR(32) PRIMARY KEY,
 conversation_id BIGINT NOT NULL,
 uploader_id BIGINT NOT NULL,
 name VARCHAR(255) NOT NULL,
 size BIGINT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
CREATE TABLE messages (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 conversation_id BIGINT NOT NULL,
 sender_id BIGINT NOT NULL,
 client_message_id VARCHAR(80) NOT NULL,
 seq BIGINT NOT NULL,
 content TEXT NOT NULL,
 file_id CHAR(32),
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY dedup (sender_id,client_message_id),
 UNIQUE KEY ordering (conversation_id,seq),
 FOREIGN KEY (conversation_id) REFERENCES conversations(id),
 FOREIGN KEY (file_id) REFERENCES files(id)
);
CREATE TABLE ai_jobs (
 id CHAR(32) PRIMARY KEY,
 user_id BIGINT NOT NULL,
 conversation_id BIGINT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
