/* eslint-disable prettier/prettier */
import { Migration } from '@mikro-orm/migrations';

export class Migration20261126221120 extends Migration {

  override name = 'Migration20261126221120';

  override up(): void | Promise<void> {
    this.addSql(`create table "transaciton" ("id" uuid not null, "wallet_id" uuid not null, "type" varchar(20) not null, "status" varchar(20) not null, "amount" numeric(20,2) not null, "currency" varchar(3) not null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`create table "ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" varchar(6) not null, "amount" numeric(20,2) not null, "currency" varchar(3) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_transaction_unique" unique ("transaction_id");`);

    this.addSql(`alter table "transaciton" add constraint "transaciton_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "transaciton" add constraint "transactions_amount_valid" check (amount >= 0 AND amount <> 'NaN'::numeric);`);
    this.addSql(`alter table "transaciton" add constraint "transactions_type_valid" check (type IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);
    this.addSql(`alter table "transaciton" add constraint "transactions_status_valid" check (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`);

    this.addSql(`alter table "ledger_entries" add constraint "ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "transaciton" ("id") on delete restrict;`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_amount_positive" check (amount > 0 AND amount <> 'NaN'::numeric);`);
    this.addSql(`alter table "ledger_entries" add constraint "ledger_direction_valid" check (direction IN ('CREDIT', 'DEBIT'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ledger_entries" drop constraint "ledger_entries_transaction_id_foreign";`);

    this.addSql(`drop table if exists "transaciton" cascade;`);
    this.addSql(`drop table if exists "ledger_entries" cascade;`);
  }

}
