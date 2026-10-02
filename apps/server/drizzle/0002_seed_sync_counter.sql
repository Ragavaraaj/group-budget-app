-- The change counter behind every row's server_seq (docs/data-model.md). It must start with its one row.
INSERT OR IGNORE INTO `sync_counter` (`id`, `value`) VALUES (1, 0);
