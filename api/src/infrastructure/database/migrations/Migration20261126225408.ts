import { Migration } from '@mikro-orm/migrations';

export class Migration20261126225408 extends Migration {
  override name = 'Migration20261126225408';

  override up(): void {
    this.addSql(`
    alter table "transactions"
      add column "idempotency_key" varchar(200) null,
      add column "payload_hash" varchar(64) null,
      add column "response" jsonb null;
  `);

    this.addSql(`
    alter table "transactions"
      add constraint "transactions_idempotency_unique"
      unique ("idempotency_key");
  `);
  }

  override down(): void {
    this.addSql(`
    alter table "transactions"
      drop constraint "transactions_idempotency_unique",
      drop column "response",
      drop column "payload_hash",
      drop column "idempotency_key";
  `);
  }
}
