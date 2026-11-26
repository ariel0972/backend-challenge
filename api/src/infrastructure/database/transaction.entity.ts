/* eslint-disable prettier/prettier */
import { EntitySchema } from "@mikro-orm/core";
import { WalletEntity } from "./wallet.entity";

export interface BetResult {
    transactionId: string;
    status: string;
    rejectionCode: string | null;
    balance: {
        amount: string;
        currency: string;
    };
}

export class TransactionEntity {
    id!: string;
    walletId!: WalletEntity;
    type!: string;
    status!: string;
    amount!: string;
    currency!: string;
    createdAt!: Date;
    idempotencyKey?: string;
    payloadHash?: string;
    response?: BetResult;
}


export const TransactionSchema = new EntitySchema<TransactionEntity>({
    class: TransactionEntity,
    tableName: "transactions",
    properties: {
        id: { type: "uuid", primary: true },
        walletId: { kind: "m:1", entity: () => WalletEntity, fieldName: "wallet_id", deleteRule: "restrict" },
        type: { type: "string", length: 20 },
        status: { type: "string", length: 20 },
        amount: { type: "decimal", precision: 20, scale: 2 },
        currency: { type: "string", length: 3 },
        createdAt: { type: "Date", columnType: "timestamptz", fieldName: "created_at" },
        idempotencyKey: {
            type: "string",
            length: 200,
            nullable: true,
            fieldName: "idempotency_key",
        },
        payloadHash: {
            type: "string",
            length: 64,
            nullable: true,
            fieldName: "payload_hash",
        },
        response: { type: "json", nullable: true },
    },

    uniques: [
        {
            name: "transactions_idempotency_unique",
            properties: ["idempotencyKey"],
        },
    ],

    checks: [
        {
            name: "transactions_amount_valid",
            expression: "amount >= 0 AND amount <> 'NaN'::numeric",
        },
        {
            name: "transactions_type_valid",
            expression:
                "type IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')",
        },
        {
            name: "transactions_status_valid",
            expression:
                "status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')",
        },
    ],
});
