/* eslint-disable prettier/prettier */
import { Migration } from '@mikro-orm/migrations';

export class Migration20261126233503 extends Migration {

  override name = 'Migration20261126233503';

  override up(): void {
    this.addSql(`
    CREATE FUNCTION prevent_ledger_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'LEDGER_IMMUTABLE';
    END;
    $$;
  `);

    this.addSql(`
    CREATE TRIGGER ledger_no_update_delete
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_ledger_mutation();
  `);

    this.addSql(`
    CREATE TRIGGER ledger_no_truncate
    BEFORE TRUNCATE ON ledger_entries
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_ledger_mutation();
  `);
  }

  override down(): void {
    this.addSql(
      'DROP TRIGGER ledger_no_truncate ON ledger_entries;',
    );
    this.addSql(
      'DROP TRIGGER ledger_no_update_delete ON ledger_entries;',
    );
    this.addSql(
      'DROP FUNCTION prevent_ledger_mutation();',
    );
  }

}
