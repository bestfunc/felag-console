-- Token 由同内网的 Felag Server 自举。server_base 由部署侧按需配置。
CREATE TABLE IF NOT EXISTS ${table_prefix}billing_config (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
