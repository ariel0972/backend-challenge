import { Migration } from '@mikro-orm/migrations';

export class Migration20261126231000 extends Migration {
  override name = 'Migration20261126231000';

  override up(): void {
  this.addSql(
    'alter table "transactions" add column "context" jsonb null;',
  );
}

override down(): void {
  this.addSql(
    'alter table "transactions" drop column "context";',
  );
}

}
