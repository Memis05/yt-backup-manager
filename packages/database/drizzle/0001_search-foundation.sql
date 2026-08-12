CREATE VIRTUAL TABLE `media_search` USING fts5(
	`media_item_id` UNINDEXED,
	`title`,
	`channel_title`,
	`playlist_titles`,
	tokenize = 'unicode61 remove_diacritics 2'
);
