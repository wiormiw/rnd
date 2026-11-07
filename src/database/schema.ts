import { sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

export const topics = pgTable('topics', {
	id: uuid('id').primaryKey().defaultRandom(),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

export const topicPrerequisites = pgTable(
	'topic_prerequisites',
	{
		topicId: uuid('topic_id')
			.notNull()
			.references(() => topics.id, { onDelete: 'cascade' }),
		prerequisiteId: uuid('prerequisite_id')
			.notNull()
			.references(() => topics.id, { onDelete: 'cascade' }),
	},
	(t) => [
		primaryKey({ columns: [t.topicId, t.prerequisiteId] }),
		check('topic_prerequisites_no_self', sql`${t.topicId} <> ${t.prerequisiteId}`),
		index('topic_prerequisites_prerequisite_id_idx').on(t.prerequisiteId),
	],
);

export const memos = pgTable(
	'memos',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		title: text('title').notNull(),
		body: text('body').notNull().default(''),
		topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index('memos_topic_id_idx').on(t.topicId)],
);

export const cards = pgTable(
	'cards',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		topicId: uuid('topic_id')
			.notNull()
			.references(() => topics.id, { onDelete: 'cascade' }),
		memoId: uuid('memo_id').references(() => memos.id, { onDelete: 'set null' }),
		front: text('front').notNull(),
		back: text('back').notNull(),
		estimatedMinutes: integer('estimated_minutes').notNull().default(2),
		priorityWeight: real('priority_weight').notNull().default(1),
		smInterval: integer('sm_interval').notNull().default(0),
		smRepetition: integer('sm_repetition').notNull().default(0),
		smEaseFactor: real('sm_ease_factor').notNull().default(2.5),
		nextReviewAt: timestamp('next_review_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		check('cards_estimated_minutes_min', sql`${t.estimatedMinutes} >= 1`),
		check('cards_priority_weight_positive', sql`${t.priorityWeight} > 0`),
		check('cards_sm_ease_factor_min', sql`${t.smEaseFactor} >= 1.3`),
		index('cards_next_review_at_idx').on(t.nextReviewAt),
		index('cards_topic_id_idx').on(t.topicId),
	],
);

export const reviewLogs = pgTable(
	'review_logs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		cardId: uuid('card_id')
			.notNull()
			.references(() => cards.id, { onDelete: 'cascade' }),
		qualityScore: integer('quality_score').notNull(),
		timeSpentSeconds: integer('time_spent_seconds').notNull(),
		previousInterval: integer('previous_interval').notNull(),
		newInterval: integer('new_interval').notNull(),
		previousEaseFactor: real('previous_ease_factor').notNull(),
		newEaseFactor: real('new_ease_factor').notNull(),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		check('review_logs_quality_score_range', sql`${t.qualityScore} between 0 and 5`),
		check('review_logs_time_spent_non_negative', sql`${t.timeSpentSeconds} >= 0`),
		index('review_logs_card_id_reviewed_at_idx').on(t.cardId, t.reviewedAt),
	],
);

export const actionItemStatus = pgEnum('action_item_status', ['PENDING', 'DONE']);

export const actionItems = pgTable(
	'action_items',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		cardId: uuid('card_id')
			.notNull()
			.references(() => cards.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		status: actionItemStatus('status').notNull().default('PENDING'),
		spawnedAt: timestamp('spawned_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
	},
	(t) => [
		uniqueIndex('action_items_one_pending_per_card')
			.on(t.cardId)
			.where(sql`${t.status} = 'PENDING'`),
		index('action_items_status_idx').on(t.status),
	],
);
