import { Migration } from '@mikro-orm/migrations';

export class Migration20261126234147 extends Migration {

  override name = 'Migration20261126234147';

  override up(): void {
    this.addSql(`
    ALTER TABLE transactions
      ADD COLUMN reference_external_transaction_id varchar(200),
      ADD COLUMN reference_id uuid REFERENCES transactions(id),
      ADD COLUMN attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN next_attempt_at timestamptz;
  `);

    this.addSql(`
    CREATE UNIQUE INDEX transactions_reference_operation_unique
    ON transactions (reference_id, type)
    WHERE status = 'PROCESSED'
      AND type IN ('REFUND', 'ROLLBACK');
  `);

    this.addSql(`
    CREATE UNIQUE INDEX transactions_provider_external_unique
    ON transactions (
      (context->>'providerId'),
      (context->>'externalTransactionId')
    )
    WHERE context IS NOT NULL;
  `);

    this.addSql(`
    CREATE INDEX transactions_pending_reference_due
    ON transactions (next_attempt_at)
    WHERE status = 'PENDING_REFERENCE';
  `);
  }

  override down(): void {
    this.addSql('DROP INDEX transactions_pending_reference_due;');
    this.addSql('DROP INDEX transactions_provider_external_unique;');
    this.addSql('DROP INDEX transactions_reference_operation_unique;');

    this.addSql(`
    ALTER TABLE transactions
      DROP COLUMN next_attempt_at,
      DROP COLUMN attempts,
      DROP COLUMN reference_id,
      DROP COLUMN reference_external_transaction_id;
  `);
  }

}
