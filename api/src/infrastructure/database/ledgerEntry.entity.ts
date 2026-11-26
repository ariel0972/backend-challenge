/* eslint-disable prettier/prettier */
import { EntitySchema } from "@mikro-orm/core";
import { WalletEntity } from "./wallet.entity";
import { TransactionEntity } from "./transaction.entity";

export class LedgerEntryEntity {
    id!: string;
    walletId!: WalletEntity;
    transactionId!: TransactionEntity;
    direction!: string;
    amount!: string;
    currency!: string;
    createdAt!: Date;
}

export const LedgerEntrySchema = new EntitySchema<LedgerEntryEntity>({
    class: LedgerEntryEntity,
    tableName: "ledger_entries",

    properties: {
        id: { type: "uuid", primary: true },
        walletId: { kind: "m:1", entity: () => WalletEntity, fieldName: "wallet_id", deleteRule: "restrict" },
        transactionId: { kind: "m:1", entity: () => TransactionEntity, fieldName: "transaction_id", deleteRule: "restrict" },
        direction: { type: "string", length: 6 },
        amount: { type: "decimal", precision: 20, scale: 2 },
        currency: { type: "string", length: 3 },
        createdAt: { type: "Date", columnType: "timestamptz", fieldName: "created_at" },
    },

    uniques: [
        {
            name: "ledger_transaction_unique",
            properties: ["transactionId"],
        },
    ],

    checks: [
        {
            name: "ledger_amount_positive",
            expression: "amount > 0 AND amount <> 'NaN'::numeric",
        },
        {
            name: "ledger_direction_valid",
            expression: "direction IN ('CREDIT', 'DEBIT')",
        },
    ],
});