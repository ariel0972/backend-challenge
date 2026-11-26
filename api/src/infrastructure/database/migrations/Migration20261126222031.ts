import { Migration } from '@mikro-orm/migrations';

export class Migration20261126222031 extends Migration {

  override name = 'Migration20261126222031';

  override up(): void {
    this.addSql('alter table "transaciton" rename to "transactions";');
  }

  override down(): void {
    this.addSql('alter table "transactions" rename to "transaciton";');
  }

}
