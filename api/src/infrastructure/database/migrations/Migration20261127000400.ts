/* eslint-disable prettier/prettier */
import { Migration } from '@mikro-orm/migrations';

export class Migration20261127000400 extends Migration {

  override name = 'Migration20261127000400';

  override up(): void {
    this.addSql(`
    create table inbox_messages (
      consumer_name varchar(100) not null,
      message_id varchar(200) not null,
      payload_hash varchar(64) not null,
      response jsonb not null,
      received_at timestamptz not null default now(),
      processed_at timestamptz not null default now(),
      primary key (consumer_name, message_id)
    );
  `);

    this.addSql(`
    create table outbox_events (
      id uuid primary key,
      aggregate_id uuid not null,
      event_type varchar(100) not null,
      payload jsonb not null,
      occurred_at timestamptz not null,
      attempts integer not null default 0,
      next_attempt_at timestamptz not null default now(),
      published_at timestamptz,
      constraint outbox_attempts_nonnegative check (attempts >= 0)
    );
  `);

    this.addSql(`
    create index outbox_pending_idx
    on outbox_events (next_attempt_at, occurred_at)
    where published_at is null;
  `);
  }

  override down(): void {
    this.addSql("drop table outbox_events;");
    this.addSql("drop table inbox_messages;");
  }

}
