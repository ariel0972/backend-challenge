/* eslint-disable prettier/prettier */
import { Migration } from '@mikro-orm/migrations';

export class Migration20261126205025 extends Migration {

  override name = 'Migration20261126205025';

  override up(): void | Promise<void> {
    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" varchar(3) not null, "balance" numeric(20,2) not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_currency_unique" unique ("player_id", "currency");`);

    this.addSql(`alter table "wallets" add constraint "wallets_balance_nonnegative" check (balance >= 0 AND balance <> 'NaN'::numeric);`);
    this.addSql(`alter table "wallets" add constraint "wallets_version_positive" check (version >= 1);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "wallets" cascade;`);
  }

}
